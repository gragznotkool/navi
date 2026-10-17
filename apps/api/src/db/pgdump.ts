import { spawn } from "node:child_process";
import type { Response } from "express";
import { AppError } from "../utils/errors.js";

export const backupFileName = (now: Date = new Date()): string => `opshub-backup-${now.toISOString().replace(/[:.]/g, "-")}.dump`;

export interface BackupOptions {
  /** Owner/admin connection: the application role cannot read every table under RLS. */
  adminUrl: string;
  pgDumpPath: string;
  fileName: string;
}

/**
 * Streams a custom-format pg_dump to the response and resolves with the byte count.
 * Headers are sent only after pg_dump produced its first byte, so a missing binary or a failed
 * connection is a clean 503 instead of a corrupt download. A failure after that point destroys the
 * connection so the client cannot mistake a truncated file for a complete backup.
 * Credentials go through the environment, never argv (visible in process listings).
 */
export function streamBackup(res: Response, { adminUrl, pgDumpPath, fileName }: BackupOptions): Promise<number> {
  const url = new URL(adminUrl);
  const proc = spawn(pgDumpPath, ["--format=custom", "--no-owner", "--no-privileges"], {
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise<number>((resolve, reject) => {
    let bytes = 0;
    let started = false;
    let stderr = "";
    const unavailable = (detail: string) => new AppError(503, "backup_unavailable", `Backup could not be created: ${detail.trim().slice(0, 300) || "pg_dump failed"}`);

    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", (e) => reject(unavailable(e.message)));
    proc.stdout.on("data", (chunk: Buffer) => {
      if (!started) {
        started = true;
        res.status(200);
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("content-disposition", `attachment; filename="${fileName}"`);
        res.setHeader("cache-control", "no-store");
      }
      bytes += chunk.length;
      if (!res.write(chunk)) {
        proc.stdout.pause();
        res.once("drain", () => proc.stdout.resume());
      }
    });
    proc.on("close", (code) => {
      if (code === 0 && started) {
        res.end();
        resolve(bytes);
      } else if (!started) {
        reject(unavailable(stderr || `pg_dump exited with code ${code}`));
      } else {
        res.destroy();
        reject(new Error(`pg_dump failed mid-stream (code ${code}): ${stderr.trim().slice(0, 300)}`));
      }
    });
    res.on("close", () => {
      if (!res.writableEnded) proc.kill();
    });
  });
}
