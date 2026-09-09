/**
 * Which parts of Theia's own AI surface SPEXR hides.
 *
 * `@theia/ai-core`, `@theia/ai-core-ui` and `@theia/ai-mcp` arrive transitively
 * through `@theia/plugin-ext`, and Theia's extension collector registers the
 * modules of transitive packages just like direct ones. Their commands and
 * preferences would sit next to SPEXR's own agent surface offering a second,
 * unrelated way to configure language models — so they are removed.
 *
 * Kept free of Theia imports so it can be unit-tested without the browser DI
 * runtime; the side that talks to Theia lives in
 * ai-surface-curation-contribution.ts.
 */

/**
 * Command ids contributed by Theia's AI packages, hidden from the palette and
 * every menu.
 *
 * Listed one by one rather than matched by prefix: the ids share no common
 * prefix (`ai-chat-ui.`, `ai-configuration.`, `aiConfiguration.`,
 * `theia-ai-prompt-template:`), and a prefix wide enough to catch them all
 * would also catch SPEXR's own commands.
 */
export const HIDDEN_AI_COMMAND_IDS: readonly string[] = [
  // @theia/ai-core — opens the AI settings, which SPEXR does not use.
  "ai-chat-ui.show-settings",
  // @theia/ai-core — discards prompt-template customizations.
  "theia-ai-prompt-template:discard",
  // @theia/ai-core-ui — context menu of the AI configuration settings widget.
  "ai-configuration.setting.copyId",
  "ai-configuration.setting.copyJson",
  "ai-configuration.setting.reset",
  // @theia/ai-mcp — adds an MCP server to Theia's own registry.
  "aiConfiguration.mcp.addServer",
];

/**
 * Preference ids hidden from the Settings UI.
 *
 * Theia's own `HideAiPreferencesContribution` already hides every `ai-features.*`
 * preference **except** this placeholder, which it leaves visible so that
 * `@theia/ai-ide` can render a button opening the AI Configuration view. SPEXR
 * does not depend on `@theia/ai-ide`, so the placeholder would render as a row
 * of dead text pointing at a view that does not exist.
 */
export const HIDDEN_AI_PREFERENCE_IDS: readonly string[] = ["ai-features.openConfiguration"];

/**
 * The subset of {@link HIDDEN_AI_COMMAND_IDS} that is actually registered.
 *
 * Intersecting rather than unregistering blindly keeps the caller from acting on
 * ids that a Theia upgrade renamed or dropped: what comes back is what exists
 * now, so a stale entry in the list above is inert instead of throwing.
 */
export function registeredAiCommandsToHide(
  registeredIds: Iterable<string>,
  hidden: readonly string[] = HIDDEN_AI_COMMAND_IDS,
): string[] {
  const wanted = new Set(hidden);
  const found: string[] = [];
  for (const id of registeredIds) {
    if (wanted.has(id) && !found.includes(id)) found.push(id);
  }
  return found;
}

/**
 * Ids from {@link HIDDEN_AI_COMMAND_IDS} that no longer exist in the registry.
 *
 * Reported so a Theia upgrade that renames a command surfaces as a log line
 * rather than as an AI command quietly reappearing in the palette.
 */
export function staleAiCommandIds(
  registeredIds: Iterable<string>,
  hidden: readonly string[] = HIDDEN_AI_COMMAND_IDS,
): string[] {
  const registered = new Set(registeredIds);
  return hidden.filter((id) => !registered.has(id));
}
