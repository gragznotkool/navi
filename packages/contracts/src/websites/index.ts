import { z } from "zod";
import { isoTimestamp, uuid } from "../common/index.js";
import { siteSlugSchema } from "../provisioning/index.js";

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "must be a #RRGGBB color");

/**
 * The visual identity of a deployed website. Stored in the site configuration (`website`), so a
 * release carries its look with it and rollback restores the old look too.
 */
export const websiteThemeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(60),
  shell: z.enum(["sidebar", "topbar", "workbench"]),
  headerStyle: z.enum(["minimal", "hero", "split", "centered"]),
  contentDensity: z.enum(["compact", "comfortable", "spacious"]),
  palette: z.object({
    primary: hex,
    secondary: hex,
    accent: hex,
    surface: hex,
    background: hex,
    text: hex,
    muted: hex,
    border: hex,
    success: hex,
    warning: hex,
    danger: hex,
  }),
  fontFamily: z.string().regex(/^[A-Za-z0-9 ]{2,40}$/),
  headingFont: z.string().regex(/^[A-Za-z0-9 ]{2,40}$/),
  borderRadius: z.string().regex(/^\d{1,2}px$/),
  cardStyle: z.enum(["flat", "elevated", "bordered", "glassmorphic"]),
  buttonStyle: z.enum(["rounded", "pill", "sharp", "soft"]),
  tableStyle: z.enum(["striped", "bordered", "minimal", "hoverable"]),
  navPosition: z.enum(["left", "top", "bottom"]),
  navStyle: z.enum(["icons-only", "icons-text", "text-only"]),
});
export type WebsiteTheme = z.infer<typeof websiteThemeSchema>;

const status = { success: "#16A34A", warning: "#D97706", danger: "#DC2626" };

/** Six built-in themes. All light, plain colours, no gradients. */
export const WEBSITE_THEMES: readonly WebsiteTheme[] = [
  {
    id: "ocean-breeze",
    name: "Ocean Breeze",
    shell: "sidebar",
    headerStyle: "minimal",
    contentDensity: "comfortable",
    palette: { primary: "#0EA5E9", secondary: "#0369A1", accent: "#F59E0B", surface: "#FFFFFF", background: "#F0F9FF", text: "#0F172A", muted: "#64748B", border: "#DBEAFE", ...status },
    fontFamily: "Inter",
    headingFont: "Inter",
    borderRadius: "10px",
    cardStyle: "elevated",
    buttonStyle: "rounded",
    tableStyle: "hoverable",
    navPosition: "left",
    navStyle: "icons-text",
  },
  {
    id: "coral-garden",
    name: "Coral Garden",
    shell: "topbar",
    headerStyle: "hero",
    contentDensity: "spacious",
    palette: { primary: "#F97316", secondary: "#C2410C", accent: "#14B8A6", surface: "#FFFFFF", background: "#FFF7ED", text: "#431407", muted: "#9A6B53", border: "#FED7AA", ...status },
    fontFamily: "Poppins",
    headingFont: "Poppins",
    borderRadius: "14px",
    cardStyle: "bordered",
    buttonStyle: "pill",
    tableStyle: "striped",
    navPosition: "top",
    navStyle: "text-only",
  },
  {
    id: "lavender-fields",
    name: "Lavender Fields",
    shell: "workbench",
    headerStyle: "split",
    contentDensity: "comfortable",
    palette: { primary: "#8B5CF6", secondary: "#6D28D9", accent: "#EC4899", surface: "#FFFFFF", background: "#F5F3FF", text: "#2E1065", muted: "#7C6F9B", border: "#E4DCFB", ...status },
    fontFamily: "DM Sans",
    headingFont: "DM Sans",
    borderRadius: "16px",
    cardStyle: "glassmorphic",
    buttonStyle: "soft",
    tableStyle: "minimal",
    navPosition: "top",
    navStyle: "icons-text",
  },
  {
    id: "emerald-valley",
    name: "Emerald Valley",
    shell: "sidebar",
    headerStyle: "centered",
    contentDensity: "spacious",
    palette: { primary: "#10B981", secondary: "#047857", accent: "#84CC16", surface: "#FFFFFF", background: "#F0FDF4", text: "#052E16", muted: "#5F7F6E", border: "#D1FAE5", ...status },
    fontFamily: "Outfit",
    headingFont: "Outfit",
    borderRadius: "6px",
    cardStyle: "flat",
    buttonStyle: "soft",
    tableStyle: "bordered",
    navPosition: "left",
    navStyle: "icons-only",
  },
  {
    id: "rose-petal",
    name: "Rose Petal",
    shell: "topbar",
    headerStyle: "hero",
    contentDensity: "comfortable",
    palette: { primary: "#EC4899", secondary: "#BE185D", accent: "#8B5CF6", surface: "#FFFFFF", background: "#FDF2F8", text: "#500724", muted: "#9D5C7B", border: "#FBCFE8", ...status },
    fontFamily: "Sora",
    headingFont: "Sora",
    borderRadius: "20px",
    cardStyle: "elevated",
    buttonStyle: "pill",
    tableStyle: "hoverable",
    navPosition: "bottom",
    navStyle: "icons-text",
  },
  {
    id: "amber-glow",
    name: "Amber Glow",
    shell: "workbench",
    headerStyle: "split",
    contentDensity: "compact",
    palette: { primary: "#F59E0B", secondary: "#B45309", accent: "#0EA5E9", surface: "#FFFFFF", background: "#FFFBEB", text: "#1C1917", muted: "#78716C", border: "#FDE68A", ...status },
    fontFamily: "Space Grotesk",
    headingFont: "Space Grotesk",
    borderRadius: "0px",
    cardStyle: "bordered",
    buttonStyle: "sharp",
    tableStyle: "striped",
    navPosition: "top",
    navStyle: "text-only",
  },
];

/** Template id for a website whose module graph was assembled freely rather than from a template. */
export const CUSTOM_TEMPLATE_ID = "custom";

export const getWebsiteTheme = (id: string): WebsiteTheme | undefined => WEBSITE_THEMES.find((t) => t.id === id);

/** A ready-made website: a module graph (from a preset) dressed in a theme. */
export const websiteTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tagline: z.string(),
  presetId: z.string(),
  theme: websiteThemeSchema,
  /** Business (non-platform) module names, for the card. */
  modules: z.array(z.string()),
  moduleCount: z.number().int(),
  /** Full configuration without identity; the builder loads it onto the canvas. */
  configuration: z.unknown(),
});
export type WebsiteTemplate = z.infer<typeof websiteTemplateSchema>;

export const websiteAccessSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all"), roleId: z.string().min(1) }),
  z.object({ mode: z.literal("selected"), roleId: z.string().min(1), userIds: z.array(uuid).max(500) }),
]);
export type WebsiteAccess = z.infer<typeof websiteAccessSchema>;

export const websiteDeployRequestSchema = z.object({
  name: z.string().trim().min(2, "Enter a website name").max(80),
  slug: siteSlugSchema,
  templateId: z.string().min(1),
  theme: websiteThemeSchema,
  /** The module graph and settings to deploy. The server compiles it and injects identity. */
  configuration: z.record(z.string(), z.unknown()),
  access: websiteAccessSchema,
});
export type WebsiteDeployRequest = z.infer<typeof websiteDeployRequestSchema>;

export const websiteDeployResponseSchema = z.object({
  jobId: uuid,
  slug: z.string(),
  path: z.string(),
  created: z.boolean(),
});
export type WebsiteDeployResponse = z.infer<typeof websiteDeployResponseSchema>;

export const websiteAccessEntrySchema = z.object({
  userId: uuid,
  email: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
});
export type WebsiteAccessEntry = z.infer<typeof websiteAccessEntrySchema>;

export const deployedWebsiteSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  path: z.string(),
  themeId: z.string(),
  themeName: z.string(),
  primary: z.string(),
  shell: z.string(),
  version: z.number().int(),
  memberCount: z.number().int(),
  createdAt: isoTimestamp,
});
export type DeployedWebsite = z.infer<typeof deployedWebsiteSchema>;

export const platformUserSchema = z.object({
  id: uuid,
  email: z.string(),
  displayName: z.string(),
  isPlatformAdmin: z.boolean(),
});
export type PlatformUser = z.infer<typeof platformUserSchema>;

export const updateWebsiteAccessRequestSchema = z.object({ access: websiteAccessSchema });
export type UpdateWebsiteAccessRequest = z.infer<typeof updateWebsiteAccessRequestSchema>;

/** Where a deployed website lives in the web app. */
export const websitePath = (slug: string): string => `/w/${slug}`;
