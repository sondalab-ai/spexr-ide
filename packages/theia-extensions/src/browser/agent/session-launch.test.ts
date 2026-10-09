import { describe, expect, it } from "vitest";
import { agentSessionKey, withSessionId } from "./session-launch.js";

const ID = "8f2a4c1e-3b7d-4e52-9a61-0c5d2e8b7f13";

describe("withSessionId", () => {
  it("appends --session-id to a bare launch", () => {
    expect(withSessionId([], ID)).toEqual(["--session-id", ID]);
  });

  it("appends it after the other arguments, which is where a launch profile's wrapper receives it", () => {
    expect(withSessionId(["--append-system-prompt-file", "/p/x.md"], ID)).toEqual(["--append-system-prompt-file", "/p/x.md", "--session-id", ID]);
  });

  it.each([["--session-id"], ["--resume"], ["-r"], ["--continue"], ["-c"], ["--session-id=abc"]])("leaves args that already choose the session (%s)", (flag) => {
    expect(withSessionId([flag, "x"], ID)).toEqual([flag, "x"]);
  });

  it("does not mutate its input", () => {
    const args = ["a"];
    withSessionId(args, ID);
    expect(args).toEqual(["a"]);
  });
});

describe("agentSessionKey", () => {
  it("is per workspace", () => {
    expect(agentSessionKey("file:///a")).not.toBe(agentSessionKey("file:///b"));
    expect(agentSessionKey("file:///a")).toBe("spexr.agent.session:file:///a");
  });
});
