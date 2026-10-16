import { z } from "zod";

export const importRowActionSchema = z.enum(["create", "update", "unchanged", "error"]);
export type ImportRowAction = z.infer<typeof importRowActionSchema>;

export const importRowReportSchema = z.object({
  /** 1-based spreadsheet row number (the header is row 1). */
  row: z.number().int(),
  sku: z.string(),
  action: importRowActionSchema,
  /** Plain-English list of what changes for this row. */
  changes: z.array(z.string()),
  errors: z.array(z.string()),
});
export type ImportRowReport = z.infer<typeof importRowReportSchema>;

export const importReportSchema = z.object({
  /** True when nothing was written (a preview, or an import that had errors). */
  dryRun: z.boolean(),
  /** True when the rows were written. An import with any error row writes nothing. */
  applied: z.boolean(),
  /** True when an earlier request with the same Idempotency-Key already did this import. */
  replayed: z.boolean(),
  totals: z.object({
    rows: z.number().int(),
    create: z.number().int(),
    update: z.number().int(),
    unchanged: z.number().int(),
    errors: z.number().int(),
    /** Rows that change a stock quantity; each writes a ledger entry when applied. */
    stockChanges: z.number().int(),
  }),
  /** Problems with the file as a whole (unknown column, too many rows, …). */
  fileErrors: z.array(z.string()),
  rows: z.array(importRowReportSchema),
});
export type ImportReport = z.infer<typeof importReportSchema>;
