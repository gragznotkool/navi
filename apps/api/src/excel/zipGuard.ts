import { AppError } from "../utils/errors.js";

export const MAX_FILE_BYTES = 1_000_000;
const MAX_UNCOMPRESSED_BYTES = 20_000_000;
const MAX_ENTRIES = 100;

const bad = (message: string) => new AppError(422, "invalid_spreadsheet", message);

/**
 * Rejects anything that is not a plausible .xlsx BEFORE it is handed to the spreadsheet parser: wrong signature,
 * too many parts, or a total expanded size far beyond what a 1 MB upload should ever contain (a zip bomb).
 * Reads only the zip's central directory; nothing is decompressed here.
 */
export function assertSafeXlsx(buf: Buffer): void {
  if (buf.length === 0) throw bad("The file is empty.");
  if (buf.length > MAX_FILE_BYTES) throw new AppError(413, "file_too_large", "The file is larger than 1 MB.");
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw bad("This is not an Excel (.xlsx) file.");

  // Find the end-of-central-directory record (it may be followed by a short comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad("This is not a valid Excel (.xlsx) file.");
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries > MAX_ENTRIES) throw bad("The file contains too many parts.");
  if (cdOffset + cdSize > buf.length) throw bad("This is not a valid Excel (.xlsx) file.");

  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad("This is not a valid Excel (.xlsx) file.");
    total += buf.readUInt32LE(p + 24);
    if (total > MAX_UNCOMPRESSED_BYTES) throw bad("The file expands to an unreasonable size.");
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}
