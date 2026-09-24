import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import type { SpexrTodoWidget } from "./todo-widget.js";

export const TODO_VIEW_ID = "spexr.view.todo";

@injectable()
export class SpexrTodoViewContribution extends AbstractViewContribution<SpexrTodoWidget> {
  constructor() {
    super({
      widgetId: TODO_VIEW_ID,
      widgetName: nls.localize("spexr/todo/title", "TODO"),
      defaultWidgetOptions: {
        area: "right",
        rank: 3,
      },
      toggleCommandId: "spexr.view.todo.toggle",
    });
  }
}
