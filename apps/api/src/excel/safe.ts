/**
 * Spreadsheet formula injection: a text cell that begins with = + - @ (or a tab / carriage return) is treated as
 * a formula by Excel and LibreOffice, and as the start of a command by some CSV consumers. Every string we write
 * is prefixed with an apostrophe when it starts with one of those characters, so it is shown as plain text.
 */
const DANGEROUS_START = new Set(["=", "+", "-", "@", "\t", "\r"]);

export const startsDangerously = (text: string): boolean => text.length > 0 && DANGEROUS_START.has(text[0]!);

/** Makes a value safe to write into a cell. Non-strings (numbers, booleans, dates) cannot carry a formula. */
export function neutralizeCell<T>(value: T): T | string {
  return typeof value === "string" && startsDangerously(value) ? `'${value}` : value;
}

/** Reverses `neutralizeCell` on import, so an exported file can be imported back without growing apostrophes. */
export function restoreCell(text: string): string {
  return text.length > 1 && text[0] === "'" && DANGEROUS_START.has(text[1]!) ? text.slice(1) : text;
}
