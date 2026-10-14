#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseStatement } from "./import/csv.js";
import { loadLedger } from "./ledger/store.js";
import { reconcile } from "./reconcile/match.js";

const LEDGER = process.env.LEDGERLINE_FILE ?? "ledger.json";

async function main(argv: string[]): Promise<number> {
  const [command, file] = argv;
  if (command === "import" && file) {
    const rows = parseStatement(await readFile(file, "utf8"));
    console.log(`${rows.length} rows read from ${file}`);
    return 0;
  }
  if (command === "reconcile" && file) {
    const rows = parseStatement(await readFile(file, "utf8"));
    const matches = reconcile(rows, await loadLedger(LEDGER));
    console.log(`${matches.length} of ${rows.length} rows matched`);
    return matches.length === rows.length ? 0 : 1;
  }
  console.error("usage: ledgerline import <file> | ledgerline reconcile <file>");
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
