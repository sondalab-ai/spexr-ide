import { describe, it, expect } from "vitest";
import { SingleFlight } from "./single-flight.js";

describe("SingleFlight", () => {
  it("does not start a second run while one is in flight", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const sf = new SingleFlight(async () => {
      runs += 1;
      await gate;
    });

    void sf.run();
    void sf.run();
    void sf.run();
    expect(runs).toBe(1);

    release();
    await sf.settled();
    expect(runs).toBe(2); // one rerun for the requests that arrived mid-flight
  });

  it("does not rerun when nothing was requested during the run", async () => {
    let runs = 0;
    const sf = new SingleFlight(async () => {
      runs += 1;
    });
    await sf.run();
    await sf.settled();
    expect(runs).toBe(1);
  });

  it("does not carry a pending rerun past a failed run", async () => {
    let runs = 0;
    let fail = true;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const sf = new SingleFlight(async () => {
      runs += 1;
      if (fail) {
        await gate;
        throw new Error("boom");
      }
    });

    const first = sf.run();
    void sf.run(); // arrives mid-flight → marks the run dirty
    release();
    await expect(first).rejects.toThrow("boom");

    fail = false;
    runs = 0;
    await sf.run();
    await sf.settled();
    expect(runs).toBe(1); // the dirty flag from the failed run must not leak
  });
});
