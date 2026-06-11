import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Effect } from "effect";
import {
  createEvent,
  createJsonlEventStore,
  createMethodRegistry,
  type EventStore,
  type MethodRegistry,
  type PlasticEvent
} from "@plastic/core";
import {
  createRuntimeMethodContext,
  registerRuntimeModules,
  type AppendEvent,
  type EventInput,
  type RuntimeCapability,
  type RuntimeMethodContext,
  type RuntimeModule,
  type RuntimeModuleRegistration,
  type RunPromise
} from "./runtime-method-context.js";

export type PlasticRuntime = {
  workspaceDir: string;
  eventPath: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
  context: RuntimeMethodContext;
  registerModules: (
    modules: RuntimeModule[],
    onRegister?: (module: RuntimeModule) => void
  ) => Promise<RuntimeModuleRegistration[]>;
};

export const createPlasticRuntime = async (input: {
  workspaceDir: string;
  eventPath: string;
  capabilities: RuntimeCapability[];
  runPromise?: RunPromise;
}): Promise<PlasticRuntime> => {
  mkdirSync(dirname(input.eventPath), { recursive: true });

  const runPromise = input.runPromise ?? (<A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect));
  const eventStore = await createJsonlEventStore(input.eventPath);
  const methods = createMethodRegistry();
  const appendEvent = (eventInput: EventInput): Promise<PlasticEvent> =>
    runPromise(eventStore.append(createEvent(eventInput)));
  const context = createRuntimeMethodContext({
    eventStore,
    methods,
    runPromise,
    appendEvent,
    capabilities: input.capabilities
  });

  return {
    workspaceDir: input.workspaceDir,
    eventPath: input.eventPath,
    eventStore,
    methods,
    runPromise,
    appendEvent,
    context,
    registerModules: (modules, onRegister) => registerRuntimeModules(context, modules, onRegister)
  };
};
