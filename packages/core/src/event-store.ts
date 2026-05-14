import { Effect } from "effect";
import type { PlasticEvent } from "./events.js";

export interface EventStore {
  append: (event: PlasticEvent) => Effect.Effect<PlasticEvent>;
  list: () => Effect.Effect<PlasticEvent[]>;
  subscribe: (listener: (event: PlasticEvent) => void) => Effect.Effect<() => void>;
}

export const createMemoryEventStore = (seed: PlasticEvent[] = []): EventStore => {
  const events = [...seed];
  const listeners = new Set<(event: PlasticEvent) => void>();

  return {
    append: (event) =>
      Effect.sync(() => {
        events.push(event);
        for (const listener of listeners) {
          listener(event);
        }
        return event;
      }),
    list: () => Effect.sync(() => [...events]),
    subscribe: (listener) =>
      Effect.sync(() => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      })
  };
};

