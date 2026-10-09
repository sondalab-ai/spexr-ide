import { describe, expect, it } from "vitest";
import { keyboardButton, pressesButton, WINDOW_CONTROL_LABELS, type ControlElement } from "./window-controls.js";

/** A stand-in for Theia's control `<div>`: records attributes and its one keydown listener. */
function fakeControl(): ControlElement & { attrs: Record<string, string>; press(key: string): boolean } {
  const attrs: Record<string, string> = {};
  let onKey: ((event: { key: string; preventDefault(): void }) => void) | undefined;
  return {
    attrs,
    tabIndex: -1,
    setAttribute: (name, value) => void (attrs[name] = value),
    addEventListener: (_type, listener) => void (onKey = listener),
    press(key) {
      let prevented = false;
      onKey?.({ key, preventDefault: () => void (prevented = true) });
      return prevented;
    },
  };
}

describe("Theia's window controls, made keyboard buttons", () => {
  it("names each control Theia builds", () => {
    expect(WINDOW_CONTROL_LABELS).toEqual({ minimize: "Minimize", maximize: "Maximize", restore: "Restore", close: "Close" });
  });

  it("gives the control a role, its name and a tab stop", () => {
    const control = fakeControl();
    keyboardButton(control, "Close", () => undefined);
    expect(control.attrs).toEqual({ role: "button", "aria-label": "Close" });
    expect(control.tabIndex).toBe(0);
  });

  it("runs the click handler on Enter and Space, and only on those", () => {
    const control = fakeControl();
    let runs = 0;
    keyboardButton(control, "Minimize", () => runs++);
    expect(control.press("Enter")).toBe(true);
    expect(control.press(" ")).toBe(true);
    expect(control.press("Tab")).toBe(false);
    expect(control.press("Escape")).toBe(false);
    expect(runs).toBe(2);
    expect(pressesButton("Spacebar")).toBe(false);
  });
});
