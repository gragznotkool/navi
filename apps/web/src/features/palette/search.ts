import type { PaletteCommand } from "../../stores/palette";

/** Every typed word must appear somewhere in the label or keywords; word-start and label matches rank first. */
export function searchCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  const scored: { c: PaletteCommand; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const label = c.label.toLowerCase();
    const hay = `${label} ${c.keywords?.toLowerCase() ?? ""}`;
    if (!words.every((w) => hay.includes(w))) return;
    const score = words.reduce((n, w) => n + (label.startsWith(w) ? 0 : label.includes(` ${w}`) ? 1 : label.includes(w) ? 2 : 3), 0);
    scored.push({ c, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((x) => x.c);
}
