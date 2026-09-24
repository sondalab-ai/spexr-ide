import { describe, expect, it } from "vitest";
import { extractLinks } from "./session-links.js";
import type { TurnEntry } from "./turns.js";

const assistant = (text: string): TurnEntry => ({
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const toolResult = (content: unknown): TurnEntry => ({
  message: { role: "user", content: [{ type: "tool_result", content }] },
});
const toolUse = (command: string): TurnEntry => ({
  message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command } }] },
});

describe("extractLinks", () => {
  it("finds the pull request gh printed", () => {
    const links = extractLinks([toolResult("https://github.com/sondalab-ai/spexr-ide/pull/45\n")]);
    expect(links).toEqual([
      { kind: "pr", url: "https://github.com/sondalab-ai/spexr-ide/pull/45", label: "PR #45 · spexr-ide" },
    ]);
  });

  it("reduces a link into a pull request's tabs or comments to the pull request", () => {
    const links = extractLinks([
      assistant("See https://github.com/o/r/pull/7/files#diff-1 and https://github.com/o/r/pull/7#issuecomment-2."),
    ]);
    expect(links.map((l) => l.url)).toEqual(["https://github.com/o/r/pull/7"]);
  });

  it("finds a dev server, normalising loopback hosts and dropping trailing punctuation", () => {
    const links = extractLinks([
      toolResult([{ type: "text", text: "  ➜  Local:   \u001b[36mhttp://127.0.0.1:5173/\u001b[39m" }]),
      assistant("The API is up at http://0.0.0.0:8080/health."),
    ]);
    expect(links).toEqual([
      { kind: "local", url: "http://localhost:8080/health", label: "localhost:8080/health" },
      { kind: "local", url: "http://localhost:5173/", label: "localhost:5173" },
    ]);
  });

  it("orders links by when the session last mentioned them, newest first", () => {
    const links = extractLinks([
      toolResult("https://github.com/o/r/pull/1"),
      toolResult("http://localhost:3000"),
      assistant("Back to https://github.com/o/r/pull/1"),
    ]);
    expect(links.map((l) => l.url)).toEqual(["https://github.com/o/r/pull/1", "http://localhost:3000"]);
  });

  it("ignores URLs that only appear in commands the agent ran, and other sites", () => {
    const links = extractLinks([
      toolUse("curl http://localhost:9999"),
      assistant("Docs: https://example.com/guide and https://github.com/o/r/issues/3"),
    ]);
    expect(links).toEqual([]);
  });

  it("does not take an error's port for a server the session started", () => {
    const links = extractLinks([toolResult("Error: listen EADDRINUSE: address already in use :::3000")]);
    expect(links).toEqual([]);
  });
});
