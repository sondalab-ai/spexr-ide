import * as React from "@theia/core/shared/react";
import type { SessionLink } from "../../common/darkfactory-protocol.js";
import { normalizeAddress, type CardBrowserState } from "./card-browser.js";

/** What a card needs to host its browser (spec 0016). */
export interface CardBrowserProps {
  /** The card's key: its session id, or a launched card's placeholder. */
  readonly cardKey: string;
  readonly state: CardBrowserState;
  readonly links: readonly SessionLink[];
  readonly onToggle: () => void;
  readonly onNavigate: (url: string, how: "typed" | "picked") => void;
  readonly onOpenExternal: (url: string) => void;
}

/** The part of Electron's `<webview>` element the pane drives. */
interface WebviewTag extends HTMLElement {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  isLoading(): boolean;
}

/** Guests of every card share one persistent session, so a GitHub sign-in holds. */
const PARTITION = "persist:spexr-card-browser";

/** Whether this renderer has Electron's `<webview>` (it is off outside Electron). */
function webviewSupported(): boolean {
  return typeof customElements !== "undefined" && customElements.get("webview") !== undefined;
}

/**
 * The browser under a pinned card's body: a toolbar and an Electron
 * `<webview>`. The element is created imperatively, once per mount, and driven
 * through its methods: rendering its `src` from React would reload the page on
 * every re-render. Loads are triggered by a new `state.request` sequence
 * number; what the page then navigates to on its own only updates the toolbar.
 */
export function CardBrowserPane(props: CardBrowserProps): React.ReactElement {
  const { state, links, onNavigate, onOpenExternal } = props;
  const supported = React.useMemo(webviewSupported, []);
  const host = React.useRef<HTMLDivElement | null>(null);
  const view = React.useRef<WebviewTag | null>(null);
  const ready = React.useRef(false);
  const pending = React.useRef<string | undefined>(undefined);
  const loadedSeq = React.useRef<number | undefined>(undefined);
  const [address, setAddress] = React.useState(state.request?.url ?? "");
  const [nav, setNav] = React.useState({ back: false, forward: false, loading: false });

  React.useLayoutEffect(() => {
    const el = host.current;
    if (!supported || !el) return undefined;
    const wv = document.createElement("webview") as WebviewTag;
    wv.className = "spexr-df-browser__view";
    wv.setAttribute("partition", PARTITION);
    wv.setAttribute("src", state.request?.url ?? "about:blank");
    loadedSeq.current = state.request?.seq;
    const sync = (): void => {
      const url = wv.getURL();
      if (url && url !== "about:blank") setAddress(url);
      setNav({ back: wv.canGoBack(), forward: wv.canGoForward(), loading: wv.isLoading() });
    };
    wv.addEventListener("dom-ready", () => {
      ready.current = true;
      const url = pending.current;
      pending.current = undefined;
      if (url) void wv.loadURL(url).catch(() => {});
      sync();
    });
    for (const event of ["did-navigate", "did-navigate-in-page", "did-start-loading", "did-stop-loading"]) {
      wv.addEventListener(event, () => {
        if (ready.current) sync();
      });
    }
    el.appendChild(wv);
    view.current = wv;
    return () => {
      wv.remove();
      view.current = null;
      ready.current = false;
    };
    // Created once per mount; later requests go through loadURL below.
  }, [supported]);

  React.useEffect(() => {
    const req = state.request;
    if (!req || req.seq === loadedSeq.current) return;
    loadedSeq.current = req.seq;
    setAddress(req.url);
    const wv = view.current;
    if (!wv) return;
    if (ready.current) void wv.loadURL(req.url).catch(() => {});
    else pending.current = req.url;
  }, [state.request]);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const url = normalizeAddress(address);
    if (url) onNavigate(url, "typed");
  };
  const current = view.current && ready.current ? view.current.getURL() : state.request?.url;

  return (
    <div className="spexr-df-browser">
      <div className="spexr-df-browser__bar">
        <button
          className="spexr-df-browser__icon"
          title="Back"
          disabled={!nav.back}
          onClick={() => view.current?.goBack()}
        >
          <i className="codicon codicon-arrow-left" />
        </button>
        <button
          className="spexr-df-browser__icon"
          title="Forward"
          disabled={!nav.forward}
          onClick={() => view.current?.goForward()}
        >
          <i className="codicon codicon-arrow-right" />
        </button>
        <button
          className="spexr-df-browser__icon"
          title="Reload"
          disabled={!state.request}
          onClick={() => view.current?.reload()}
        >
          <i className={`codicon ${nav.loading ? "codicon-loading codicon-modifier-spin" : "codicon-refresh"}`} />
        </button>
        <form className="spexr-df-browser__address" onSubmit={submit}>
          <input
            className="spexr-df-browser__input"
            value={address}
            placeholder="Type an address, or pick a link the session produced"
            spellCheck={false}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-label="Address"
          />
        </form>
        {links.length > 0 && (
          <select
            className="spexr-df-browser__links"
            value=""
            title="Links this session produced"
            aria-label="Links this session produced"
            onChange={(e) => {
              if (e.target.value) onNavigate(e.target.value, "picked");
            }}
          >
            <option value="">{`Session links (${links.length})`}</option>
            {links.map((l) => (
              <option key={l.url} value={l.url}>
                {l.label}
              </option>
            ))}
          </select>
        )}
        {!state.following && links.length > 0 && (
          <span className="spexr-df-browser__paused" title="You typed an address; pick a session link to follow the session again">
            not following
          </span>
        )}
        <button
          className="spexr-df-browser__icon"
          title="Open in the system browser"
          disabled={!current}
          onClick={() => current && onOpenExternal(current)}
        >
          <i className="codicon codicon-link-external" />
        </button>
      </div>
      {supported ? (
        <div className="spexr-df-browser__stage">
          {/* Holds only the imperatively created <webview>; React renders nothing inside it. */}
          <div className="spexr-df-browser__host" ref={host} />
          {!state.request && (
            <div className="spexr-df-browser__empty spexr-df-browser__empty--overlay">
              This session hasn&apos;t produced a link yet. Type an address above, or wait: a pull
              request or a local server it starts will open here.
            </div>
          )}
        </div>
      ) : (
        <div className="spexr-df-browser__empty">
          The embedded browser needs the desktop app.
          {links.length > 0 ? " Open one of the session's links in your system browser:" : ""}
          {links.map((l) => (
            <button key={l.url} className="spexr-button" onClick={() => onOpenExternal(l.url)}>
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
