import { afterEach, describe, expect, it, vi } from "vitest";
import { changelogUrl, fetchReleaseNotes } from "./release-notes-source.js";

const CHANGELOG = ["## 0.1.5 — 2026-07-02", "> a tagline", "- a change"].join("\n");

function stubFetch(handler: (url: string) => { ok: boolean; body?: string } | Error): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const result = handler(url);
      if (result instanceof Error) throw result;
      return { ok: result.ok, text: async () => result.body ?? "" };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchReleaseNotes", () => {
  it("reads the changelog at the tag of the running version", async () => {
    stubFetch(() => ({ ok: true, body: CHANGELOG }));

    const notes = await fetchReleaseNotes("0.1.5");

    expect(fetch).toHaveBeenCalledWith(changelogUrl("v0.1.5"), expect.anything());
    expect(notes.map((n) => n.version)).toEqual(["0.1.5"]);
  });

  it("falls back to the default branch when the tag does not exist", async () => {
    stubFetch((url) => (url.includes("/v0.9.9/") ? { ok: false } : { ok: true, body: CHANGELOG }));

    const notes = await fetchReleaseNotes("0.9.9");

    expect(fetch).toHaveBeenLastCalledWith(changelogUrl("main"), expect.anything());
    expect(notes).toHaveLength(1);
  });

  it("reads the default branch when the version is unknown", async () => {
    stubFetch(() => ({ ok: true, body: CHANGELOG }));

    await fetchReleaseNotes(undefined);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(changelogUrl("main"), expect.anything());
  });

  it("never builds a tag out of a version it cannot validate", async () => {
    stubFetch(() => ({ ok: true, body: CHANGELOG }));

    await fetchReleaseNotes("../../evil/main");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(changelogUrl("main"), expect.anything());
  });

  it("returns nothing when the network fails", async () => {
    stubFetch(() => new Error("offline"));

    expect(await fetchReleaseNotes("0.1.5")).toEqual([]);
  });

  it("returns nothing when every ref answers with an error status", async () => {
    stubFetch(() => ({ ok: false }));

    expect(await fetchReleaseNotes("0.1.5")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
