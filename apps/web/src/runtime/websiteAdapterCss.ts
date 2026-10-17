/**
 * The module screens are styled with the OpsHub admin palette (fixed hex utility classes). Inside a
 * deployed website, this stylesheet re-points each of those colours to the website theme's tokens,
 * scoped under [data-website], so every existing module renders in the website's identity without a
 * per-theme copy of any component. Generated once; the class list mirrors the admin palette.
 */

type Role = { bg?: string; text?: string; border?: string };

const PALETTE: Record<string, Role> = {
  "080909": { bg: "--ws-bg", text: "--ws-on-primary", border: "--ws-border" },
  "111313": { bg: "--ws-surface-2", text: "--ws-text-2", border: "--ws-border" },
  "171919": { bg: "--ws-surface", border: "--ws-border" },
  "1f2222": { bg: "--ws-surface-2", border: "--ws-border" },
  "202422": { bg: "--ws-surface-2", border: "--ws-border" },
  "1f2321": { bg: "--ws-surface-2", border: "--ws-border" },
  "151717": { bg: "--ws-surface", border: "--ws-border" },
  "0c0e0e": { bg: "--ws-surface-2", border: "--ws-border" },
  "0d0f0e": { bg: "--ws-surface-2", border: "--ws-border" },
  "242826": { bg: "--ws-surface-2", border: "--ws-border" },
  "252827": { bg: "--ws-surface-2", border: "--ws-border" },
  "303432": { bg: "--ws-border", text: "--ws-muted", border: "--ws-border" },
  "424845": { bg: "--ws-border", border: "--ws-border" },
  F5F5F0: { bg: "--ws-surface", text: "--ws-text", border: "--ws-border" },
  A5A8A6: { text: "--ws-text-2", border: "--ws-border" },
  "777C79": { text: "--ws-muted", border: "--ws-border" },
  FFE500: { bg: "--ws-primary", text: "--ws-secondary", border: "--ws-primary" },
  E8D000: { bg: "--ws-secondary", text: "--ws-secondary", border: "--ws-secondary" },
  FF5C5C: { bg: "--ws-danger", text: "--ws-danger", border: "--ws-danger" },
  "39D98A": { bg: "--ws-success", text: "--ws-success", border: "--ws-success" },
  FFB547: { bg: "--ws-warning", text: "--ws-warning", border: "--ws-warning" },
  "63B3ED": { bg: "--ws-accent", text: "--ws-accent", border: "--ws-accent" },
};

/** Colours that appear with an opacity modifier (bg-[#FFE500]/10 and friends). */
const TRANSLUCENT = ["FFE500", "FF5C5C", "39D98A", "FFB547", "63B3ED", "111313", "0c0e0e"];
const OPACITIES = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90];
const STATES: [prefix: string, pseudo: string][] = [["", ""], ["hover:", ":hover"], ["focus:", ":focus"]];

const esc = (cls: string) => cls.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
const casings = (hex: string) => [...new Set([hex, hex.toUpperCase(), hex.toLowerCase()])];

export function buildAdapterCss(scope = "[data-website]"): string {
  const groups = new Map<string, string[]>();
  const add = (decl: string, selector: string) => groups.set(decl, [...(groups.get(decl) ?? []), selector]);

  for (const [hex, role] of Object.entries(PALETTE)) {
    for (const h of casings(hex)) {
      for (const [prefix, pseudo] of STATES) {
        const sel = (util: string, suffix = "") => `${scope} .${esc(`${prefix}${util}-[#${h}]${suffix}`)}${pseudo}`;
        if (role.bg) add(`background-color:var(${role.bg})`, sel("bg"));
        if (role.text) add(`color:var(${role.text})`, sel("text"));
        if (role.border) {
          add(`border-color:var(${role.border})`, sel("border"));
          add(`border-color:var(${role.border})`, `${sel("divide")} > :not(:last-child)`);
          add(`--tw-ring-color:var(${role.border})`, sel("ring"));
        }
        if (!TRANSLUCENT.includes(hex)) continue;
        for (const o of OPACITIES) {
          const v = (cssVar: string) => `color-mix(in srgb,var(${cssVar}) ${o}%,transparent)`;
          if (role.bg) add(`background-color:${v(role.bg)}`, sel("bg", `/${o}`));
          if (role.border) {
            add(`border-color:${v(role.border)}`, sel("border", `/${o}`));
            add(`--tw-ring-color:${v(role.border)}`, sel("ring", `/${o}`));
          }
        }
      }
    }
  }
  return [...groups].map(([decl, sels]) => `${sels.join(",")}{${decl}}`).join("\n");
}
