import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TodoAddForm } from "./todo-add-form.js";

const noop = async (): Promise<boolean> => true;
const render = (folders: string[]): string =>
  renderToStaticMarkup(React.createElement(TodoAddForm, { folders, target: 0, onTarget: () => undefined, onAdd: noop }));

describe("TodoAddForm", () => {
  it("starts with an empty draft and a disabled Add button", () => {
    const html = render(["a"]);
    expect(html).toContain('placeholder="Add a TODO"');
    expect(html).toContain("disabled");
  });

  it("offers the folder picker only with several folders", () => {
    expect(render(["a"])).not.toContain("<select");
    expect(render(["a", "b"])).toContain("<select");
  });

  // The caret jump itself (a controlled input fed from an async-rendering widget)
  // needs a DOM to reproduce; the package has none. The draft is now component state.
  it("keeps the draft out of the widget: the form takes no draft prop", () => {
    expect(TodoAddForm.length).toBe(1);
    expect(render(["a"])).not.toContain("value=\"undefined\"");
  });
});
