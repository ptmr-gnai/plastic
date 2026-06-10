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
      handler: () => methods.list()
    })
  );

  await runPromise(
    methods.register({
      id: "methods/describe",
      title: "Describe method",
      description: "Returns one RPC method with schemas, examples, effects, links, and ownership metadata.",
      owner: { kind: "runtime", id: "plastic.runtime" },
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
