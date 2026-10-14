import { daysApart } from "../import/dates.js";
import type { Row } from "../import/csv.js";
import type { Entry } from "../ledger/store.js";

export interface Match {
  readonly row: Row;
  readonly entry: Entry;
  readonly days: number;
}

/** How far a statement date may sit from the ledger date (spec 0003, AC-1). */
export const WINDOW_DAYS = 3;
/** Rounding differences we accept on amounts (spec 0003, AC-2). */
export const TOLERANCE_CENTS = 1;

/**
 * Pair each statement row with one ledger entry of the same amount, give or
 * take a cent, dated within the window. Each entry is used at most once.
 */
export function reconcile(rows: readonly Row[], ledger: readonly Entry[]): Match[] {
  const free = new Set(ledger);
  const matches: Match[] = [];
  for (const row of rows) {
    const entry = [...free].find(
      (e) => Math.abs(e.amount - row.amount) <= TOLERANCE_CENTS && daysApart(e.date, row.date) <= WINDOW_DAYS,
    );
    if (!entry) continue;
    free.delete(entry);
    matches.push({ row, entry, days: daysApart(entry.date, row.date) });
  }
  return matches;
}
