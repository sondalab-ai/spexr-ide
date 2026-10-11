/** The name each of Theia's window controls announces, by the id createControlButton gives it. */
export const WINDOW_CONTROL_LABELS: Readonly<Record<string, string>> = {
  minimize: "Minimize",
  maximize: "Maximize",
  restore: "Restore",
  close: "Close",
};

/** The keys that press a button, as a native one answers them. */
export function pressesButton(key: string): boolean {
  return key === "Enter" || key === " ";
}

/** What keyboardButton touches on Theia's control: a structural slice, so plain node can test it. */
export interface ControlElement {
  tabIndex: number;
  setAttribute(name: string, value: string): void;
  addEventListener(type: "keydown", listener: (event: { readonly key: string; preventDefault(): void }) => void): void;
}

/**
 * Theia's window control is a bare `<div>` with a click handler, out of the
 * tab order and unnamed. This makes it a button for the keyboard and for
 * assistive technology: role, name, a tab stop, and Enter or Space running
 * the same handler as a click.
 */
export function keyboardButton(element: ControlElement, label: string, handler: () => void): void {
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", label);
  element.tabIndex = 0;
  element.addEventListener("keydown", (event) => {
    if (!pressesButton(event.key)) return;
    event.preventDefault();
    handler();
  });
}
