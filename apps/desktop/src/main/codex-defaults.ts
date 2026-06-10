import { Effect } from "effect";
import { type EventStore } from "@plastic/core";

type RunPromise = <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;

export const createCodexDefaultsReader = (input: {
  eventStore: EventStore;
  runPromise: RunPromise;
  fallbackModel: string;
  asRecord: (value: unknown) => Record<string, unknown>;
  asString: (value: unknown) => string | undefined;
}) => {
  let current = { model: input.fallbackModel };

  const getCodexDefaults = async () => {
    const events = await input.runPromise(input.eventStore.list());
    let latest: (typeof events)[number] | undefined;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.type === "codex.defaults.updated") {
        latest = events[index];
        break;
      }
    }
    const payload = input.asRecord(latest?.payload);
    current = {
      model: input.asString(payload.model) ?? input.fallbackModel
    };
    return current;
  };

  return {
    current: () => current,
    getCodexDefaults
  };
};
