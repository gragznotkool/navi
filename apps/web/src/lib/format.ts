export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export const shortId = (id: string): string => id.slice(0, 8);

/** Total units across all lines of a request. */
export const totalQuantity = (r: { lines: { quantity: number }[] }) => r.lines.reduce((n, l) => n + l.quantity, 0);
