import { Effect } from "effect";
import {
  buildTimeline,
  selectEvents,
  type EventListInput,
  type EventStore,
  type MethodRegistry,
  type TimelineInput
} from "@plastic/core";
import type { AppendEvent, RuntimeMethodContext, RuntimeModule, RunPromise } from "./runtime-method-context.js";

const runtimeControlAvailability = {
  status: "available" as const,
  notes: "Runtime control is provided by Plastic's shared method registry in headed and headless modes."
};

const eventScopeSchema = {
  type: "object",
  description: "Optional scope filter.",
  properties: {
    panelId: { type: "string" },
    agentId: { type: "string" },
    extensionId: { type: "string" },
    windowId: { type: "string" }
  }
};

const readOnlyEffects = {
  durableEvents: [],
  mutatesProjection: []
};

const readOnlyReversibility = {
  reversible: true,
  notes: "Read-only method."
};

const noInputSchema = {
  type: "object",
  properties: {}
};

const eventListMetadata = {
  inputSchema: {
    type: "object",
    properties: {
      after: { type: "string", description: "Return events after this event id." },
      before: { type: "string", description: "Return events before this event id." },
      limit: { oneOf: [{ type: "number" }, { const: "all" }], description: "Maximum events to return, or all." },
      types: { type: "array", items: { type: "string" }, description: "Optional event type filter." },
      includeDeltas: { type: "boolean", description: "Include noisy delta events." },
      scope: eventScopeSchema
    }
  },
  examples: [
    {
      title: "Read recent self-test events",
      input: { types: ["plastic.self_test.completed"], limit: 5 },
      verifyWith: { method: "events/timeline", input: { limit: 5 } }
    }
  ],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

const eventTimelineMetadata = {
  inputSchema: {
    type: "object",
    properties: {
      after: { type: "string", description: "Summarize events after this event id." },
      before: { type: "string", description: "Summarize events before this event id." },
      limit: { type: "number", description: "Maximum timeline items to return." },
      includeRaw: { type: "boolean", description: "Include raw events beside summaries." },
      includeDeltas: { type: "boolean", description: "Include noisy delta events." },
      scope: eventScopeSchema
    }
  },
  examples: [
    {
      title: "Summarize recent workspace activity",
      input: { limit: 10 },
      verifyWith: { method: "events/list", input: { limit: 10 } }
    }
  ],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

export const registerRuntimeControlMethods = async (input: RuntimeMethodContext) => {
  await registerMethodDiscovery(input);
  await registerRpcCall(input);
  await registerCapabilityDiscovery(input);
  await registerEventReaders(input);
  await registerEventAppend(input);
  await registerThemeControl(input);
};

export const runtimeControlModule: RuntimeModule = {
  id: "runtime-control",
  register: registerRuntimeControlMethods
};

const registerMethodDiscovery = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "plastic/methods",
      title: "Plastic methods",
      description: "Lists all registered RPC methods.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: runtimeControlAvailability,
      inputSchema: noInputSchema,
      examples: [
        {
          title: "List available methods",
          input: {},
          verifyWith: { method: "methods/describe", input: { id: "plastic/methods" } }
        }
      ],
      effects: readOnlyEffects,
      reversibility: readOnlyReversibility,
      handler: () => methods.list()
    })
  );

  await runPromise(
    methods.register({
      id: "methods/describe",
      title: "Describe method",
      description: "Returns one RPC method with schemas, examples, effects, links, and ownership metadata.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: runtimeControlAvailability,
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "RPC method id to describe." }
        }
      },
      examples: [
        {
          title: "Describe panel movement",
          input: { id: "panels/move" }
        }
      ],
      effects: readOnlyEffects,
      reversibility: readOnlyReversibility,
      handler: (methodInput) =>
        Effect.promise(async () => {
          const id = (methodInput as { id?: string }).id;
          if (!id) {
            throw new Error("methods/describe requires id");
          }
          const method = await runPromise(methods.get(id));
          if (!method) {
            throw new Error(`Method not found: ${id}`);
          }
          return method;
        })
    })
  );
};

const registerRpcCall = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "rpc/call",
      title: "Call RPC method",
      description: "Calls any registered Plastic RPC method through the shared method registry.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: runtimeControlAvailability,
      handler: (methodInput) =>
        Effect.promise(async () => {
          const rpcInput = methodInput as { method?: string; input?: unknown };
          if (!rpcInput.method) {
            throw new Error("rpc/call requires method");
          }
          if (rpcInput.method === "rpc/call") {
            throw new Error("rpc/call cannot call itself");
          }
          return runPromise(methods.call(rpcInput.method, rpcInput.input));
        })
    })
  );
};

const registerCapabilityDiscovery = async (input: RuntimeMethodContext) => {
  const { capabilities, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "runtime/capabilities",
      title: "Runtime capabilities",
      description: "Lists host capabilities used to derive method availability.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: {
        status: "available",
        requiredCapabilities: ["runtime.capabilities"]
      },
      inputSchema: noInputSchema,
      examples: [
        {
          title: "List host capabilities",
          input: {},
          verifyWith: { method: "methods/describe", input: { id: "runtime/capabilities" } }
        }
      ],
      effects: readOnlyEffects,
      reversibility: readOnlyReversibility,
      handler: () => Effect.succeed({
        count: capabilities.list().length,
        items: capabilities.list()
      })
    })
  );
};

const registerEventReaders = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "events/list",
      title: "List events",
      description: "Lists bounded raw events with optional type, scope, cursor, and delta filters.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: runtimeControlAvailability,
      ...eventListMetadata,
      handler: (methodInput) =>
        Effect.map(eventStore.list(), (events) => selectEvents(events, methodInput as EventListInput | undefined))
    })
  );

  await runPromise(
    methods.register({
      id: "events/timeline",
      title: "Event timeline",
      description: "Returns deterministic, agent-readable summaries of recent events with cursors and links.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: runtimeControlAvailability,
      ...eventTimelineMetadata,
      handler: (methodInput) =>
        Effect.map(eventStore.list(), (events) => buildTimeline(events, methodInput as TimelineInput | undefined))
    })
  );
};

const registerEventAppend = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
}) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "events/append",
      title: "Append event",
      description: "Appends a durable event to the Plastic event stream.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: runtimeControlAvailability,
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Durable event type. Defaults to event.appended." },
          payload: { type: "object", description: "JSON payload to store with the event." },
          scope: {
            type: "object",
            description: "Optional workspace, window, panel, extension, agent, or project scope for the event.",
            properties: {
              workspaceId: { type: "string" },
              windowId: { type: "string" },
              panelId: { type: "string" },
              extensionId: { type: "string" },
              agentId: { type: "string" },
              projectDir: { type: "string" }
            }
          }
        }
      },
      examples: [
        {
          title: "Record a durable agent note",
          input: {
            type: "agent.note.created",
            payload: { body: "Remember this observation." },
            scope: { agentId: "agent:chat-main" }
          },
          expectedEvents: ["agent.note.created"],
          verifyWith: { method: "events/list", input: { type: "agent.note.created", limit: 1 } }
        }
      ],
      effects: {
        durableEvents: ["<input.type>"],
        mutatesProjection: ["events"]
      },
      reversibility: {
        reversible: false,
        notes: "The event log is append-only; compensate by appending another event."
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const eventInput = methodInput as {
            type?: string;
            payload?: unknown;
            scope?: { workspaceId?: string; windowId?: string; panelId?: string; extensionId?: string; agentId?: string; projectDir?: string };
          };
          return appendEvent({
            type: eventInput.type ?? "event.appended",
            payload: eventInput.payload ?? {},
            ...(eventInput.scope ? { scope: eventInput.scope } : {})
          });
        })
    })
  );
};

const registerThemeControl = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
}) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "app/setTheme",
      title: "Set theme",
      description: "Durably changes the app theme projected by renderer windows.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: runtimeControlAvailability,
      inputSchema: {
        type: "object",
        properties: {
          theme: { enum: ["light", "dark"], description: "Theme to project in the app UI." }
        }
      },
      examples: [
        {
          title: "Switch to dark mode",
          input: { theme: "dark" },
          expectedEvents: ["theme.changed"],
          verifyWith: { method: "plastic/state", input: {} }
        }
      ],
      effects: {
        durableEvents: ["theme.changed"],
        mutatesProjection: ["app.theme"]
      },
      reversibility: {
        reversible: true,
        method: "app/setTheme",
        notes: "Call again with the previous theme."
      },
      handler: (methodInput) =>
        Effect.promise(async () =>
          appendEvent({
            type: "theme.changed",
            payload: { theme: (methodInput as { theme?: string }).theme === "dark" ? "dark" : "light" }
          })
        )
    })
  );
};
