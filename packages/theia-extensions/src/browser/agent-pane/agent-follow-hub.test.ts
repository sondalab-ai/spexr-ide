import { describe, expect, it } from "vitest";
import { AgentFollowHub, type FollowState } from "./agent-follow-hub.js";

describe("AgentFollowHub", () => {
  it("starts with nothing followed", () => {
    expect(new AgentFollowHub().current).toEqual({ followed: undefined, viewing: false, snapshot: undefined });
  });

  it("hands every listener what the pane publishes, and keeps it as the current state", () => {
    const hub = new AgentFollowHub();
    const seen: FollowState[] = [];
    hub.onDidChange((s) => seen.push(s));
    const next: FollowState = { followed: "a", viewing: true, snapshot: { sessionId: "a" } };
    hub.publish(next);
    expect(seen).toEqual([next]);
    expect(hub.current).toBe(next);
  });

  it("passes a view request on, and keeps it for a pane that opens later", () => {
    const hub = new AgentFollowHub();
    const asked: Array<unknown> = [];
    hub.onViewRequest((req) => asked.push(req));
    const b = { sessionId: "b", projectPath: "/w/sub" };
    hub.requestView(b);
    expect(asked).toEqual([b]);
    expect(hub.pendingView).toBe(b);
    hub.requestView(undefined);
    expect(asked).toEqual([b, undefined]);
    expect(hub.pendingView).toBeUndefined();
  });

  it("forgets a pending request when the pane that did not take it is gone", () => {
    const hub = new AgentFollowHub();
    hub.requestView({ sessionId: "b", projectPath: "/w/sub" });
    hub.clearPending();
    expect(hub.pendingView).toBeUndefined();
  });
});
