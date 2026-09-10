import { injectable } from "@theia/core/shared/inversify";
import { WebsocketFrontendConnectionService } from "@theia/core/lib/node/messaging/websocket-frontend-connection-service";

/**
 * Stopgap for a Theia 1.75 crash that takes the whole backend down.
 *
 * `WebsocketFrontendConnectionService.closeConnection` looks the channel up and
 * dereferences it unguarded, on the assumption that it is "not called when no
 * connection is present". That assumption breaks after a reconnect: the stale
 * socket keeps its `disconnect` listener, so two listeners now close the same
 * frontEndId. The second call reads `onCloseEmitter` off `undefined`, and the
 * uncaught TypeError stops the backend — killing every terminal PTY with it.
 *
 * Overriding it to skip the redundant close keeps a dropped websocket a dropped
 * websocket. Remove once upstream guards the lookup.
 */
@injectable()
export class SpexrWebsocketFrontendConnectionService extends WebsocketFrontendConnectionService {
  protected override closeConnection(frontEndId: string, reason: string): void {
    if (!this.connectionsByFrontend.has(frontEndId)) return;
    super.closeConnection(frontEndId, reason);
  }
}
