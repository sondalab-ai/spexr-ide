import { describe, expect, it } from "vitest";
import {
  terminalKindOf,
  terminalStyleKey,
  readTerminalStyle,
  xtermOptions,
  xtermTheme,
  SESSION_TERMINAL_KIND,
  AGENT_TERMINAL_KIND,
} from "./terminal-style.js";

function reader(values: Record<string, unknown>): (key: string) => unknown {
  return (key) => values[key];
}

describe("terminalKindOf", () => {
  it("recognises a darkfactory session terminal", () => {
    expect(terminalKindOf(SESSION_TERMINAL_KIND)).toBe("session");
  });

  it("recognises the side agent terminal", () => {
    expect(terminalKindOf(AGENT_TERMINAL_KIND)).toBe("agent");
  });

  it("treats Theia's own terminals as the editor family", () => {
    expect(terminalKindOf("user")).toBe("editor");
  });

  it("treats an unmarked terminal as the editor family", () => {
    expect(terminalKindOf(undefined)).toBe("editor");
  });
});

describe("terminalStyleKey", () => {
  it("namespaces by family and field", () => {
    expect(terminalStyleKey("session", "fontSize")).toBe("spexr.terminal.session.fontSize");
  });
});

describe("readTerminalStyle", () => {
  it("is empty when nothing is configured", () => {
    expect(readTerminalStyle(() => undefined, "agent")).toEqual({});
  });

  it("reads every field of its own family", () => {
    const style = readTerminalStyle(
      reader({
        "spexr.terminal.session.fontFamily": "Berkeley Mono",
        "spexr.terminal.session.fontSize": 13,
        "spexr.terminal.session.lineHeight": 1.4,
        "spexr.terminal.session.letterSpacing": 0.5,
        "spexr.terminal.session.cursorStyle": "bar",
        "spexr.terminal.session.cursorBlink": "on",
        "spexr.terminal.session.background": "#101014",
        "spexr.terminal.session.foreground": "#e8e8ea",
      }),
      "session",
    );
    expect(style).toEqual({
      fontFamily: "Berkeley Mono",
      fontSize: 13,
      lineHeight: 1.4,
      letterSpacing: 0.5,
      cursorStyle: "bar",
      cursorBlink: true,
      background: "#101014",
      foreground: "#e8e8ea",
    });
  });

  it("ignores another family's values", () => {
    const style = readTerminalStyle(reader({ "spexr.terminal.agent.fontSize": 20 }), "session");
    expect(style).toEqual({});
  });

  it("treats an empty string as unset, not as an empty font", () => {
    expect(readTerminalStyle(reader({ "spexr.terminal.editor.fontFamily": "   " }), "editor")).toEqual({});
  });

  it("drops a non-positive font size", () => {
    expect(readTerminalStyle(reader({ "spexr.terminal.editor.fontSize": 0 }), "editor")).toEqual({});
  });

  it("drops a cursor style xterm does not know", () => {
    expect(readTerminalStyle(reader({ "spexr.terminal.editor.cursorStyle": "beam" }), "editor")).toEqual({});
  });

  it("reads the tri-state cursor blink as a boolean", () => {
    expect(readTerminalStyle(reader({ "spexr.terminal.editor.cursorBlink": "off" }), "editor")).toEqual({
      cursorBlink: false,
    });
  });

  it("leaves cursor blink inherited when the preference is empty", () => {
    expect(readTerminalStyle(reader({ "spexr.terminal.editor.cursorBlink": "" }), "editor")).toEqual({});
  });
});

describe("xtermOptions", () => {
  it("passes the font and cursor fields through", () => {
    expect(xtermOptions({ fontSize: 12, cursorStyle: "block" })).toEqual({
      fontSize: 12,
      cursorStyle: "block",
    });
  });

  it("leaves the colours out — they belong to the theme", () => {
    expect(xtermOptions({ fontSize: 12, background: "#000", foreground: "#fff" })).toEqual({ fontSize: 12 });
  });
});

describe("xtermTheme", () => {
  const base = { background: "#111", foreground: "#eee", red: "#f00" };

  it("leaves the theme alone when no colour is configured", () => {
    expect(xtermTheme({ fontSize: 12 }, base)).toBeUndefined();
  });

  it("overrides only the configured colour, keeping the palette", () => {
    expect(xtermTheme({ background: "#000" }, base)).toEqual({
      background: "#000",
      foreground: "#eee",
      red: "#f00",
    });
  });

  it("overrides both when both are configured", () => {
    expect(xtermTheme({ background: "#000", foreground: "#fff" }, base)).toEqual({
      background: "#000",
      foreground: "#fff",
      red: "#f00",
    });
  });
});
