import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { runWithInput } from "./run-with-input.js";

const node = process.execPath;
const cwd = tmpdir();

describe("runWithInput", () => {
  it("feeds stdin and returns stdout with the exit status", async () => {
    const r = await runWithInput(
      node,
      ["-e", "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(s.toUpperCase()))"],
      { cwd, input: "drift", timeoutMs: 10_000 },
    );
    expect(r).toEqual({ status: 0, stdout: "DRIFT", stderr: "" });
  });

  it("reports a non-zero exit and stderr", async () => {
    const r = await runWithInput(node, ["-e", "process.stderr.write('boom');process.exit(3)"], {
      cwd,
      input: "",
      timeoutMs: 10_000,
    });
    expect(r.status).toBe(3);
    expect(r.stderr).toBe("boom");
  });

  it("kills a child that outlives the timeout", async () => {
    const r = await runWithInput(node, ["-e", "setTimeout(()=>{},60000)"], { cwd, input: "", timeoutMs: 100 });
    expect(r.status).toBeNull();
  });

  it("resolves instead of throwing when the command does not exist", async () => {
    const r = await runWithInput("/nonexistent/claude", [], { cwd, input: "x", timeoutMs: 1000 });
    expect(r.status).toBeNull();
    expect(r.stderr).toMatch(/ENOENT/);
  });

  it("does not block the event loop while the child runs", async () => {
    let ticks = 0;
    const t = setInterval(() => ticks++, 10);
    await runWithInput(node, ["-e", "setTimeout(()=>{},300)"], { cwd, input: "", timeoutMs: 10_000 });
    clearInterval(t);
    expect(ticks).toBeGreaterThan(5);
  });
});
