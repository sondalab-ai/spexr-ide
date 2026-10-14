import { parseDate, type Locale } from "./dates.js";

export interface Row {
  readonly date: Date;
  readonly description: string;
  /** Integer cents; negative for money going out. */
  readonly amount: number;
  readonly line: number;
}

/** Turn "1,234.50" or "-12.00" into integer cents without float drift. */
export function toCents(raw: string): number {
  const clean = raw.replace(/[,\s]/g, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) throw new Error(`not an amount: "${raw}"`);
  const [, sign, whole, frac = ""] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return sign ? -cents : cents;
}

/**
 * Read a bank statement export. The first line is a header; columns are
 * Date, Description, Amount, in that order, separated by commas. A quoted
 * description may itself contain commas.
 */
export function parseStatement(text: string, locale: Locale = "en-GB"): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line);
    if (cells.length < 3) throw new Error(`line ${i + 2}: expected 3 columns`);
    const [date, description, amount] = cells as [string, string, string];
    return { date: parseDate(date, locale), description: description.trim(), amount: toCents(amount), line: i + 2 };
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}
