import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "./match.js";

const day = (d: number) => new Date(Date.UTC(2026, 8, d));
const row = (d: number, amount: number) => ({ date: day(d), description: "x", amount, line: d });
const entry = (id: string, d: number, amount: number) => ({ id, date: day(d), amount, memo: id });

test("a row matches an entry three days away", () => {
  const [m] = reconcile([row(10, -500)], [entry("a", 13, -500)]);
  assert.equal(m?.entry.id, "a");
});

test("a cent of rounding still matches", () => {
  assert.equal(reconcile([row(10, -501)], [entry("a", 10, -500)]).length, 1);
});

test("four days is outside the window", () => {
  assert.equal(reconcile([row(10, -500)], [entry("a", 14, -500)]).length, 0);
});
