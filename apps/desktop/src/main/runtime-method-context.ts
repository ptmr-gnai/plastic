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

export type RuntimeCapability = {
  id: string;
  title: string;
  status: "available" | "degraded" | "unavailable";
  notes?: string;
};

export type CapabilityRegistry = {
  list: () => RuntimeCapability[];
  get: (capabilityId: string) => RuntimeCapability | undefined;
  has: (capabilityId: string) => boolean;
  missing: (capabilityIds: string[]) => string[];
};

export type RuntimeMethodContext = {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
  capabilities: CapabilityRegistry;
};

export type RuntimeModule = {
  id: string;
  register: (context: RuntimeMethodContext) => Promise<void>;
};

export const createDirectAppendEvent = (eventStore: EventStore, runPromise: RunPromise): AppendEvent =>
  (eventInput) => runPromise(eventStore.append(createEvent(eventInput)));

export const createRuntimeMethodContext = (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent?: AppendEvent;
  capabilities?: RuntimeCapability[];
}): RuntimeMethodContext => ({
  eventStore: input.eventStore,
  methods: input.methods,
  runPromise: input.runPromise,
  appendEvent: input.appendEvent ?? createDirectAppendEvent(input.eventStore, input.runPromise),
  capabilities: createCapabilityRegistry(input.capabilities ?? [])
});

export const registerRuntimeModules = async (
  context: RuntimeMethodContext,
  modules: RuntimeModule[],
  onRegister?: (module: RuntimeModule) => void
) => {
  for (const module of modules) {
    onRegister?.(module);
    await module.register(context);
  }
};

export const createCapabilityRegistry = (capabilities: RuntimeCapability[]): CapabilityRegistry => {
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
  return {
    list: () => [...byId.values()],
    get: (capabilityId) => byId.get(capabilityId),
    has: (capabilityId) => byId.get(capabilityId)?.status === "available",
    missing: (capabilityIds) =>
      capabilityIds.filter((capabilityId) => byId.get(capabilityId)?.status !== "available")
  };
};

export const availabilityFromCapabilities = (
  capabilities: CapabilityRegistry,
  requiredCapabilities: string[],
  notes?: string
) => {
  const missingCapabilities = capabilities.missing(requiredCapabilities);
  if (missingCapabilities.length === 0) {
    return { status: "available" as const, requiredCapabilities, ...(notes ? { notes } : {}) };
  }
  return {
    status: "unavailable" as const,
    requiredCapabilities,
    missingCapabilities,
    ...(notes ? { notes } : {})
  };
};
