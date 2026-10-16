import { z } from "zod";
import { isoTimestamp, uuid } from "../common/index.js";

export const auditEventSchema = z.object({
  id: uuid,
  siteId: uuid.nullable(),
  actorId: uuid.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  createdAt: isoTimestamp,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
