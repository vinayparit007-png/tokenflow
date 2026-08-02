import { emptyUsage, type Usage } from "../src/usage.js";
import type { ProviderAdapter } from "../src/adapters/index.js";

/** Fold an event stream through an adapter, starting from an empty usage. */
export function replay(adapter: ProviderAdapter, events: unknown[]): Usage {
  return events.reduce<Usage>((usage, event) => adapter.adapt(usage, event), emptyUsage());
}

/** Return a copy of `events` with every event immediately repeated. */
export function duplicateEvery<T>(events: T[]): T[] {
  return events.flatMap((event) => [event, event]);
}
