import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatement, toCents } from "./csv.js";

test("amounts become integer cents", () => {
  assert.equal(toCents("1,234.50"), 123450);
  assert.equal(toCents("-12"), -1200);
});

test("a quoted description keeps its comma", () => {
  const rows = parseStatement('Date,Description,Amount\n03/09/2026,"Rent, September",-950.00\n');
  assert.equal(rows[0]?.description, "Rent, September");
  assert.equal(rows[0]?.amount, -95000);
});

test("en-US exports put the month first", () => {
  const [row] = parseStatement("Date,Description,Amount\n09/03/2026,Coffee,-3.20\n", "en-US");
  assert.equal(row?.date.toISOString().slice(0, 10), "2026-09-03");
});
