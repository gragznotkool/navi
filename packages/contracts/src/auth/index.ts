import { z } from "zod";
import { isoTimestamp, uuid } from "../common/index.js";

export const permissionSchema = z
  .string()
  .regex(/^[a-z][a-z-]*:[a-z][a-z-]*$/, "permission must look like resource:action");
export type Permission = z.infer<typeof permissionSchema>;

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(permissionSchema),
});
export type Role = z.infer<typeof roleSchema>;

export const siteMembershipSchema = z.object({
  siteId: uuid,
  siteSlug: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(permissionSchema),
});
export type SiteMembership = z.infer<typeof siteMembershipSchema>;

/** API-safe user. Never includes the password hash. */
export const userSchema = z.object({
  id: uuid,
  email: z.string().email(),
  displayName: z.string(),
  isPlatformAdmin: z.boolean(),
});
export type User = z.infer<typeof userSchema>;

export const authSessionSchema = z.object({
  user: userSchema,
  memberships: z.array(siteMembershipSchema),
  expiresAt: isoTimestamp,
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = authSessionSchema;
export type LoginResponse = AuthSession;
