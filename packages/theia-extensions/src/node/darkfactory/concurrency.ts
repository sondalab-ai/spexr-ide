/**
 * Run `fn` over every item with at most `limit` calls in flight, resolving when
 * all complete. Errors propagate (callers fail soft inside `fn`).
 */
export async function forEachConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
