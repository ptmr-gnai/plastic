import { Effect } from "effect";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
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

export const createJsonlEventStore = async (path: string): Promise<EventStore> => {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    await appendFile(path, "", "utf8");
  }

  const events: PlasticEvent[] = [];
  const text = await readFile(path, "utf8");
  for (const line of text.split("\n")) {
    if (line.trim().length > 0) {
      events.push(JSON.parse(line) as PlasticEvent);
    }
  }

  const listeners = new Set<(event: PlasticEvent) => void>();

  return {
    append: (event) =>
      Effect.promise(async () => {
        await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
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

export const streamJsonlEvents = async (
  path: string,
  onEvent: (event: PlasticEvent) => void
): Promise<void> => {
  if (!existsSync(path)) {
    return;
  }

  const stream = createReadStream(path, "utf8");
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of lines) {
    if (line.trim().length > 0) {
      onEvent(JSON.parse(line) as PlasticEvent);
    }
  }
};
