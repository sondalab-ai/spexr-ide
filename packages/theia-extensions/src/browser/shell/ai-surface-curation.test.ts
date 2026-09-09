import { describe, expect, it } from "vitest";
import {
  HIDDEN_AI_COMMAND_IDS,
  HIDDEN_AI_PREFERENCE_IDS,
  registeredAiCommandsToHide,
  staleAiCommandIds,
} from "./ai-surface-curation.js";

describe("registeredAiCommandsToHide", () => {
  it("returns the hidden ids that are registered", () => {
    expect(
      registeredAiCommandsToHide(["core.about", "ai-chat-ui.show-settings", "core.close"]),
    ).toEqual(["ai-chat-ui.show-settings"]);
  });

  it("leaves SPEXR's own commands alone", () => {
    const spexr = ["spexr.spec.new", "spexr.agent.focus", "spexr.scm.stage"];
    expect(registeredAiCommandsToHide(spexr)).toEqual([]);
  });

  it("ignores a hidden id that is not registered", () => {
    expect(registeredAiCommandsToHide([], ["aiConfiguration.mcp.addServer"])).toEqual([]);
  });

  it("reports a registered id once even if the registry yields it twice", () => {
    expect(
      registeredAiCommandsToHide(["ai-chat-ui.show-settings", "ai-chat-ui.show-settings"]),
    ).toEqual(["ai-chat-ui.show-settings"]);
  });

  it("covers every id in the list when all of them are registered", () => {
    expect(registeredAiCommandsToHide(HIDDEN_AI_COMMAND_IDS)).toEqual([...HIDDEN_AI_COMMAND_IDS]);
  });
});

describe("staleAiCommandIds", () => {
  it("names the hidden ids the registry no longer has", () => {
    expect(staleAiCommandIds(["ai-chat-ui.show-settings"], ["ai-chat-ui.show-settings"])).toEqual(
      [],
    );
    expect(staleAiCommandIds([], ["aiConfiguration.mcp.addServer"])).toEqual([
      "aiConfiguration.mcp.addServer",
    ]);
  });

  it("says nothing is stale when every id is registered", () => {
    expect(staleAiCommandIds(HIDDEN_AI_COMMAND_IDS)).toEqual([]);
  });
});

describe("the curated lists", () => {
  it("hides the AI preference placeholder Theia deliberately leaves visible", () => {
    // Theia's own HideAiPreferencesContribution hides every `ai-features.*`
    // preference except this one, so it is the only one left to hide here.
    expect(HIDDEN_AI_PREFERENCE_IDS).toEqual(["ai-features.openConfiguration"]);
  });

  it("holds no duplicates", () => {
    expect(new Set(HIDDEN_AI_COMMAND_IDS).size).toBe(HIDDEN_AI_COMMAND_IDS.length);
  });
});
