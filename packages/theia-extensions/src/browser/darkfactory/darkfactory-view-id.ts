/**
 * Widget id of the Darkfactory main-area tab.
 *
 * Kept in its own module so consumers that must stay free of DOM-bound imports
 * (`SpexrDarkfactorySidebarPolicy` and its unit test) can reference the id
 * without pulling in the widget or its view contribution.
 */
export const DARKFACTORY_VIEW_ID = "spexr.view.darkfactory";
