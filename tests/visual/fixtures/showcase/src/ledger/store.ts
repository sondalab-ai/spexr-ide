import { readFile, writeFile } from "node:fs/promises";

export interface Entry {
  readonly id: string;
  readonly date: Date;
  /** Integer cents. */
  readonly amount: number;
  readonly memo: string;
}

interface StoredEntry {
  id: string;
  date: string;
  amount: number;
  memo: string;
}

/** The ledger is one JSON file, an array of entries, dates as YYYY-MM-DD. */
export async function loadLedger(file: string): Promise<Entry[]> {
  const raw = JSON.parse(await readFile(file, "utf8")) as StoredEntry[];
  return raw.map((e) => ({ ...e, date: new Date(`${e.date}T00:00:00Z`) }));
}

export async function saveLedger(file: string, entries: readonly Entry[]): Promise<void> {
  const stored: StoredEntry[] = entries.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) }));
  await writeFile(file, JSON.stringify(stored, null, 2) + "\n");
}
