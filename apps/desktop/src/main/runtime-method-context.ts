import { Effect } from "effect";
import {
  createEvent,
  type EventStore,
  type MethodRegistry,
  type PlasticEvent
} from "@plastic/core";

export type RunPromise = <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;
export type EventInput = Parameters<typeof createEvent>[0];
export type AppendEvent = (eventInput: EventInput) => Promise<PlasticEvent>;

export type RuntimeMethodContext = {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
};

export const createDirectAppendEvent = (eventStore: EventStore, runPromise: RunPromise): AppendEvent =>
  (eventInput) => runPromise(eventStore.append(createEvent(eventInput)));

export const createRuntimeMethodContext = (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent?: AppendEvent;
}): RuntimeMethodContext => ({
  eventStore: input.eventStore,
  methods: input.methods,
  runPromise: input.runPromise,
  appendEvent: input.appendEvent ?? createDirectAppendEvent(input.eventStore, input.runPromise)
});
