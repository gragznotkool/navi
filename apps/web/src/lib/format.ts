export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export const shortId = (id: string): string => id.slice(0, 8);
