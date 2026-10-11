import { expect, it } from "vitest";
import { checkBudget } from "../src/audit";

it("passes a cached resolve under budget", () => {
  expect(checkBudget(1.8)).toEqual([]);
});

it("blocks the build over budget", () => {
  expect(checkBudget(2.4)[0]?.level).toBe("R");
});
