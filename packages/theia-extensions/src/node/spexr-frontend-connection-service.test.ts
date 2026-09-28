import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { BackendApplicationConfigProvider } from "@theia/core/lib/node/backend-application-config-provider";
import { ConnectionManagementMessages } from "@theia/core/lib/common/messaging/connection-management";
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

/** A socket.io stand-in that records listeners so a test can fire its events. */
function fakeSocket() {
  const listeners = new Map<string, (arg?: unknown) => void>();
  return {
    on: (event: string, fn: (arg?: unknown) => void) => void listeners.set(event, fn),
    off: (event: string) => void listeners.delete(event),
    emit: vi.fn(),
    fire: (event: string, arg?: unknown) => listeners.get(event)?.(arg),
  };
}

describe("the desktop app's connection timeout across sleep", () => {
  const desktopManifest = new URL("../../../../apps/desktop/package.json", import.meta.url);
  const configKey = (BackendApplicationConfigProvider as unknown as { KEY: symbol }).KEY;
  const savedEnv = process.env.FRONTEND_CONNECTION_TIMEOUT;

  beforeAll(() => {
    delete process.env.FRONTEND_CONNECTION_TIMEOUT;
    const manifest = JSON.parse(readFileSync(desktopManifest, "utf8"));
    BackendApplicationConfigProvider.set(manifest.theia.backend.config);
  });

  afterAll(() => {
    delete (globalThis as Record<symbol, unknown>)[configKey];
    if (savedEnv !== undefined) process.env.FRONTEND_CONNECTION_TIMEOUT = savedEnv;
  });

  // On wake, socket.io reports "ping timeout". With Theia's default timeout of 0
  // the backend dropped the window's connection there and then, the reconnect
  // found nothing to resume, and every terminal went dead.
  test("a ping timeout keeps the connection, and the reconnect after wake resumes it", () => {
    const service = serviceUnderTest(new SpexrWebsocketFrontendConnectionService()) as unknown as ReturnType<
      typeof serviceUnderTest
    > & {
      handleSocketDisconnect(socket: unknown, channel: unknown, frontEndId: string): void;
      handleConnection(socket: unknown, onChannel: (channel: unknown) => void): Promise<void>;
    };
    const channel = { ...fakeChannel(), disconnect: vi.fn(), connect: vi.fn() };
    const asleep = fakeSocket();
    service.connectionsByFrontend.set("1", channel);
    service.handleSocketDisconnect(asleep, channel, "1");

    asleep.fire("disconnect", "ping timeout");

    expect(channel.close).not.toHaveBeenCalled();
    expect(service.connectionsByFrontend.get("1")).toBe(channel);

    const awake = fakeSocket();
    void service.handleConnection(awake, vi.fn());
    awake.fire(ConnectionManagementMessages.RECONNECT, "1");

    expect(awake.emit).toHaveBeenCalledWith(ConnectionManagementMessages.RECONNECT, true);
    expect(channel.connect).toHaveBeenCalledWith(awake);
  });
});
