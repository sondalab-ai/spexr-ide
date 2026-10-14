/** Locales the bank exports we have seen use. */
export type Locale = "en-GB" | "en-US";

const SEP = /[/.-]/;

/**
 * Parse a statement date into a UTC day. Banks write the day and the month
 * in their own order, so the locale decides which field is which.
 */
export function parseDate(raw: string, locale: Locale): Date {
  const parts = raw.trim().split(SEP).map((p) => Number(p));
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) {
    throw new Error(`not a date: "${raw}"`);
  }
  const [a, b, c] = parts as [number, number, number];
  const [day, month] = locale === "en-GB" ? [a, b] : [b, a];
  const year = c < 100 ? 2000 + c : c;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`out of range: "${raw}" (${locale})`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/** Whole days between two UTC days, always positive. */
export function daysApart(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}
