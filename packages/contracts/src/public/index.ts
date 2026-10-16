import { z } from "zod";

/** The only fields a public (signed-out) visitor may send. Unknown keys are rejected, never ignored. */
export const publicRequestSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            sku: z
              .string()
              .trim()
              .min(1, "Enter an item code")
              .max(64)
              .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Item codes use letters, digits and . _ / - only"),
            quantity: z.number().int("Quantity must be a whole number").min(1, "Quantity must be at least 1").max(100, "Quantity cannot be more than 100"),
          })
          .strict(),
      )
      .min(1, "Add at least one item")
      .max(5, "At most 5 items per request"),
    note: z.string().trim().max(200, "Keep the note under 200 characters").optional(),
    /** Honeypot: real people never see or fill this field. A filled value is silently dropped. */
    website: z.string().max(200).optional(),
  })
  .strict();
export type PublicRequest = z.infer<typeof publicRequestSchema>;

/** Deliberately says nothing about the request, the stock or the site. */
export const publicRequestAcceptedSchema = z.object({ accepted: z.literal(true) });
export type PublicRequestAccepted = z.infer<typeof publicRequestAcceptedSchema>;
