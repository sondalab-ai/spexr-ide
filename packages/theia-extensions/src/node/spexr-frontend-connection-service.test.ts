import { describe, expect, test, vi } from "vitest";
import { WebsocketFrontendConnectionService } from "@theia/core/lib/node/messaging/websocket-frontend-connection-service";
import { SpexrWebsocketFrontendConnectionService } from "./spexr-frontend-connection-service.js";

/** Minimal stand-in for the parts of a ReconnectableSocketChannel that closing touches. */
function fakeChannel() {
  return {
    onCloseEmitter: { fire: vi.fn() },
    drainBuffer: vi.fn(),
    close: vi.fn(),
  };
}

/** Wire the injected members `closeConnection` reads, and expose it to the test. */
function serviceUnderTest<T extends WebsocketFrontendConnectionService>(service: T) {
  const wired = service as unknown as {
    logger: { info: (msg: string) => void };
    connectionsByFrontend: Map<string, unknown>;
    closeConnection(frontEndId: string, reason: string): void;
  };
  wired.logger = { info: vi.fn() };
  return wired;
}

describe("SpexrWebsocketFrontendConnectionService", () => {
  test("closes a live connection exactly as upstream does", () => {
    const service = serviceUnderTest(new SpexrWebsocketFrontendConnectionService());
    const channel = fakeChannel();
    service.connectionsByFrontend.set("1", channel);

    service.closeConnection("1", "socket closed");

    expect(channel.onCloseEmitter.fire).toHaveBeenCalledWith({ reason: "socket closed" });
    expect(channel.close).toHaveBeenCalledOnce();
    expect(service.connectionsByFrontend.has("1")).toBe(false);
  });

  test("a second close of the same front end is a no-op, not a backend-killing throw", () => {
    const service = serviceUnderTest(new SpexrWebsocketFrontendConnectionService());
    const channel = fakeChannel();
    service.connectionsByFrontend.set("1", channel);

    service.closeConnection("1", "socket closed");

    expect(() => service.closeConnection("1", "socket closed")).not.toThrow();
    expect(channel.close).toHaveBeenCalledOnce();
  });

  test("upstream still throws on the second close — the guard is what fixes it", () => {
    const service = serviceUnderTest(new WebsocketFrontendConnectionService());
    service.connectionsByFrontend.set("1", fakeChannel());

    service.closeConnection("1", "socket closed");

    expect(() => service.closeConnection("1", "socket closed")).toThrow(TypeError);
  });
});
