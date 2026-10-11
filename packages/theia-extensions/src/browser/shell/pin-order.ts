/**
 * The order of a main-area tab bar's pinned tabs (S6c, D8): Welcome, Specs
 * and the agent terminal lead; Darkfactory, the agents' wall, trails every
 * editor, as Lumen's "Agent · <name>" tab does. The tabs in between keep the
 * order they have.
 *
 * Pure, so the order is tested without Theia: `ids` are the bar's widget ids
 * in their current order.
 */
export function pinnedOrder(ids: readonly string[], leading: readonly string[], trailing: readonly string[]): string[] {
  const present = new Set(ids);
  const head = leading.filter((id) => present.has(id));
  const tail = trailing.filter((id) => present.has(id) && !head.includes(id));
  const pinned = new Set([...head, ...tail]);
  return [...head, ...ids.filter((id) => !pinned.has(id)), ...tail];
}
