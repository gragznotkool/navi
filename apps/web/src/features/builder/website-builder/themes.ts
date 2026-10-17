import type { CSSProperties } from "react";
import { WEBSITE_THEMES, type WebsiteTheme } from "@opshub/contracts";

export { WEBSITE_THEMES };
export type { WebsiteTheme };

/** Short, friendly presentation for galleries. */
export const THEME_EMOJI: Record<string, string> = {
  "ocean-breeze": "🌊",
  "coral-garden": "🌺",
  "lavender-fields": "💜",
  "emerald-valley": "🌿",
  "rose-petal": "🌸",
  "amber-glow": "🔆",
};

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Text colour to put on a solid primary background: white unless the theme's text reads better. */
export const onColor = (bg: string, dark: string): string => (contrast(bg, "#FFFFFF") >= contrast(bg, dark) ? "#FFFFFF" : dark);

const DENSITY_PAD = { compact: "16px", comfortable: "28px", spacious: "40px" } as const;
const CELL_PAD = { compact: "6px", comfortable: "10px", spacious: "14px" } as const;

export function buttonRadius(t: WebsiteTheme): string {
  if (t.buttonStyle === "pill") return "999px";
  if (t.buttonStyle === "sharp") return "0px";
  return t.borderRadius;
}

const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/**
 * The whole visual identity as CSS custom properties. The app-level tokens (--bg, --surface, …) are
 * redefined too, so token-based components follow the theme without knowing it exists.
 */
export function themeVars(t: WebsiteTheme): CSSProperties {
  const p = t.palette;
  const font = `"${t.fontFamily}", "Inter Variable", system-ui, sans-serif`;
  const vars: Record<string, string> = {
    "--ws-primary": p.primary,
    "--ws-secondary": p.secondary,
    "--ws-accent": p.accent,
    "--ws-surface": p.surface,
    "--ws-surface-2": mix(p.background, p.surface, 55),
    "--ws-bg": p.background,
    "--ws-text": p.text,
    "--ws-text-2": mix(p.text, p.muted, 55),
    "--ws-muted": p.muted,
    "--ws-border": p.border,
    "--ws-success": p.success,
    "--ws-warning": p.warning,
    "--ws-danger": p.danger,
    "--ws-on-primary": onColor(p.primary, p.text),
    "--ws-primary-soft": mix(p.primary, p.surface, 14),
    "--ws-font": font,
    "--ws-heading-font": `"${t.headingFont}", ${font}`,
    "--ws-radius": t.borderRadius,
    "--ws-btn-radius": buttonRadius(t),
    "--ws-pad": DENSITY_PAD[t.contentDensity],
    "--ws-cell-pad": CELL_PAD[t.contentDensity],
    // App tokens, so bg-surface / text-muted / border-line / accent follow the theme.
    "--bg": p.background,
    "--bg-secondary": mix(p.background, p.surface, 55),
    "--surface": p.surface,
    "--surface-elevated": p.surface,
    "--text": p.text,
    "--text-secondary": mix(p.text, p.muted, 55),
    "--muted": p.muted,
    "--border": p.border,
    "--border-subtle": p.border,
    "--yellow": p.primary,
    "--accent": p.primary,
    "--accent-2": p.secondary,
    "--success": p.success,
    "--warning": p.warning,
    "--error": p.danger,
    "--info": p.accent,
  };
  return vars as CSSProperties;
}

/** Data attributes that switch component variants in website.css. */
export const themeAttrs = (t: WebsiteTheme) => ({
  "data-website": t.id,
  "data-card": t.cardStyle,
  "data-button": t.buttonStyle,
  "data-table": t.tableStyle,
  "data-density": t.contentDensity,
});

export const slugFromName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
