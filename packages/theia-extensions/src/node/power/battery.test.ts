import { describe, expect, it } from "vitest";
import { nextSaving, parsePmset, parseSysfs } from "./battery.js";

describe("parsePmset", () => {
  it("reads a charging laptop on mains", () => {
    const out = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=35127395)\t16%; charging; 2:08 remaining present: true\n";
    expect(parsePmset(out)).toEqual({ level: 16, onBattery: false });
  });

  it("reads a laptop on battery", () => {
    const out = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t19%; discharging; 1:02 remaining present: true\n";
    expect(parsePmset(out)).toEqual({ level: 19, onBattery: true });
  });

  it("reads a desktop with no battery as undefined", () => {
    expect(parsePmset("Now drawing from 'AC Power'\n")).toBeUndefined();
  });
});

describe("parseSysfs", () => {
  it("reads capacity and a discharging status", () => {
    expect(parseSysfs("18\n", "Discharging\n")).toEqual({ level: 18, onBattery: true });
    expect(parseSysfs("18\n", "Charging\n")).toEqual({ level: 18, onBattery: false });
  });

  it("rejects an unreadable capacity", () => {
    expect(parseSysfs("?", "Discharging")).toBeUndefined();
  });
});

describe("nextSaving", () => {
  it("starts saving at 20% or below on battery", () => {
    expect(nextSaving(false, { level: 21, onBattery: true })).toBe(false);
    expect(nextSaving(false, { level: 20, onBattery: true })).toBe(true);
  });

  it("keeps saving until 30% so it does not flap around one threshold", () => {
    expect(nextSaving(true, { level: 25, onBattery: true })).toBe(true);
    expect(nextSaving(true, { level: 30, onBattery: true })).toBe(false);
  });

  it("stops saving on mains power whatever the charge", () => {
    expect(nextSaving(true, { level: 5, onBattery: false })).toBe(false);
    expect(nextSaving(false, { level: 5, onBattery: false })).toBe(false);
  });

  it("never saves without a battery reading", () => {
    expect(nextSaving(true, undefined)).toBe(false);
  });
});
