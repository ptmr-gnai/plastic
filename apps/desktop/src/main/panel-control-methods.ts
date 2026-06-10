import { Effect } from "effect";
import {
  projectPanels,
  type EventStore,
  type MethodRegistry
} from "@plastic/core";
import type { AppendEvent, RuntimeMethodContext, RuntimeModule, RunPromise } from "./runtime-method-context.js";

type PanelCreateInput = {
  id?: string;
  title?: string;
  kind?: string;
  extensionId?: string;
  rendererId?: string;
  subtitle?: string;
  body?: string;
  windowId?: string;
  order?: number;
};

const panelControlAvailability = {
  status: "available" as const,
  notes: "Panel control is a host-agnostic runtime primitive available in headed and headless modes."
};

export const registerPanelControlMethods = async (input: RuntimeMethodContext) => {
  const { eventStore, methods, runPromise, appendEvent } = input;

  await registerPanelList({ eventStore, methods, runPromise });
  await registerPanelGet({ eventStore, methods, runPromise });
  await registerPanelCreate({ methods, runPromise, appendEvent });
  await registerPanelRename({ methods, runPromise, appendEvent });
  await registerPanelMove({ methods, runPromise, appendEvent });
  await registerPanelRemove({ methods, runPromise, appendEvent });
  await registerPanelClose({ methods, runPromise, appendEvent });
};

export const panelControlModule: RuntimeModule = {
  id: "panel-control",
  register: registerPanelControlMethods
};

const registerPanelList = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "panels/list",
      title: "List panels",
      description: "Returns the panel read model rebuilt from durable events.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelControlAvailability,
      handler: () => Effect.map(eventStore.list(), projectPanels)
    })
  );
};

const registerPanelGet = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "panels/get",
      title: "Get panel",
      description: "Returns one panel from the event-projected panel read model.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelControlAvailability,
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Panel id to read." }
        }
      },
      examples: [
        {
          title: "Read a panel",
          input: { id: "chat-main" },
          verifyWith: { method: "panels/list", input: {} }
        }
      ],
      effects: {
        durableEvents: [],
        mutatesProjection: []
      },
      preconditions: ["The panel id must exist."],
      reversibility: { reversible: true, notes: "Read-only method." },
      handler: (methodInput) =>
        Effect.map(eventStore.list(), (events) => {
          const id = (methodInput as { id?: string }).id;
          const panel = projectPanels(events).find((candidate) => candidate.id === id);
          if (!panel) {
            throw new Error(`Panel not found: ${id}`);
          }
          return panel;
        })
    })
  );
};

const registerPanelCreate = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
}) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "panels/create",
      title: "Create panel",
      description: "Appends a durable panel.created event. Renderer windows project it immediately.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelControlAvailability,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Optional stable panel id. Generated when omitted." },
          title: { type: "string", description: "Panel title." },
          kind: { type: "string", description: "Panel kind, such as chat, document, tasks, or generic." },
          extensionId: { type: "string", description: "Owning extension id." },
          rendererId: { type: "string", description: "Renderer contribution id." },
          subtitle: { type: "string", description: "Optional panel subtitle." },
          body: { type: "string", description: "Optional generic body text." },
          windowId: { type: "string", description: "Optional target window id." },
          order: { type: "number", description: "Optional projected ordering value." }
        }
      },
      examples: [
        {
          title: "Create a scratch panel",
          input: { title: "Scratch", kind: "generic", body: "Notes" },
          expectedEvents: ["panel.created"],
          verifyWith: { method: "panels/list", input: {} }
        }
      ],
      effects: {
        durableEvents: ["panel.created"],
        mutatesProjection: ["panels", "windows"]
      },
      reversibility: {
        reversible: true,
        method: "panels/remove",
        notes: "Remove the generated panel id."
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const panelInput = methodInput as PanelCreateInput;
          const id = panelInput.id ?? `panel-${crypto.randomUUID().slice(0, 8)}`;
          const title = panelInput.title ?? "Untitled panel";
          const extensionId = panelInput.extensionId ?? "plastic.user";
          const scope: { panelId: string; extensionId: string; windowId?: string } = { panelId: id, extensionId };
          if (panelInput.windowId) {
            scope.windowId = panelInput.windowId;
          }

          return appendEvent({
            type: "panel.created",
            payload: {
              id,
              title,
              kind: panelInput.kind ?? "generic",
              extensionId,
              rendererId: panelInput.rendererId,
              subtitle: panelInput.subtitle,
              body: panelInput.body ?? "This panel was created through Plastic RPC.",
              windowId: panelInput.windowId,
              order: panelInput.order
            },
            scope
          });
        })
    })
  );
};

const registerPanelRename = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
}) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "panels/rename",
      title: "Rename panel",
      description: "Durably changes a panel title and optional subtitle.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelControlAvailability,
      inputSchema: {
        type: "object",
        required: ["id", "title"],
        properties: {
          id: { type: "string", description: "Panel id to rename." },
          title: { type: "string", description: "New panel title." },
          subtitle: { type: "string", description: "Optional new panel subtitle." }
        }
      },
      examples: [
        {
          title: "Rename a chat panel",
          input: { id: "chat-main", title: "Research Chat" },
          expectedEvents: ["panel.renamed"],
          verifyWith: { method: "panels/list", input: {} }
        }
      ],
      effects: {
        durableEvents: ["panel.renamed"],
        mutatesProjection: ["panels"]
      },
      preconditions: ["The panel id must exist for the rename to affect projected layout."],
      reversibility: {
        reversible: true,
        method: "panels/rename",
        notes: "Call again with the previous title/subtitle."
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const panelInput = methodInput as { id?: string; title?: string; subtitle?: string };
          if (!panelInput.id || !panelInput.title) {
            throw new Error("panels/rename requires id and title");
          }
          return appendEvent({
            type: "panel.renamed",
            payload: {
              id: panelInput.id,
              title: panelInput.title,
              subtitle: panelInput.subtitle
            },
            scope: { panelId: panelInput.id }
          });
        })
    })
  );
};

const registerPanelMove = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
}) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "panels/move",
      title: "Move panel",
      description: "Durably updates a panel's order and optionally assigns it to a window.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelControlAvailability,
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Panel id to move." },
          windowId: { type: "string", description: "Optional target window id." },
          order: { type: "number", description: "Optional projected ordering value." }
        }
      },
      examples: [
        {
          title: "Move a chat after the first panel",
          input: { id: "chat-main", order: 2 },
          expectedEvents: ["panel.moved"],
          verifyWith: { method: "panels/list", input: {} }
        }
      ],
      effects: {
        durableEvents: ["panel.moved"],
        mutatesProjection: ["panels", "windows"]
      },
      preconditions: ["The panel id must exist for the move to affect projected layout."],
      reversibility: {
        reversible: true,
        method: "panels/move",
        notes: "Call again with the previous order/windowId."
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const panelInput = methodInput as { id?: string; windowId?: string; order?: number };
          if (!panelInput.id) {
            throw new Error("panels/move requires id");
          }
          return appendEvent({
            type: "panel.moved",
            payload: {
              id: panelInput.id,
              windowId: panelInput.windowId,
              order: panelInput.order
            },
            scope: { panelId: panelInput.id }
          });
        })
    })
  );
};

const registerPanelRemove = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
}) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "panels/remove",
      title: "Remove panel",
      description: "Durably removes a panel from the projected workspace.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelControlAvailability,
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Panel id to remove." },
          reason: { type: "string", description: "Optional reason stored in the removal event." }
        }
      },
      examples: [
        {
          title: "Remove a scratch panel",
          input: { id: "scratch-panel", reason: "cleanup" },
          expectedEvents: ["panel.removed"],
          verifyWith: { method: "panels/list", input: {} }
        }
      ],
      effects: {
        durableEvents: ["panel.removed"],
        mutatesProjection: ["panels", "windows"]
      },
      preconditions: ["The panel id must exist for the removal to affect projected layout."],
      reversibility: {
        reversible: false,
        notes: "The event stream can be replayed, but there is no direct undo method yet."
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const panelInput = methodInput as { id?: string; reason?: string };
          if (!panelInput.id) {
            throw new Error("panels/remove requires id");
          }
          return appendEvent({
            type: "panel.removed",
            payload: {
              id: panelInput.id,
              reason: panelInput.reason
            },
            scope: { panelId: panelInput.id }
          });
        })
    })
  );
};

const registerPanelClose = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
}) => {
  const { methods, runPromise, appendEvent } = input;

  await runPromise(
    methods.register({
      id: "panels/close",
      title: "Close panel",
      description: "Closes a panel from the current workspace projection by appending panel.removed.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: panelControlAvailability,
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Panel id to close." },
          reason: { type: "string", description: "Optional reason stored in the removal event." }
        }
      },
      examples: [
        {
          title: "Close a panel",
          input: { id: "scratch-panel", reason: "closed" },
          expectedEvents: ["panel.removed"],
          verifyWith: { method: "panels/list", input: {} }
        }
      ],
      effects: {
        durableEvents: ["panel.removed"],
        mutatesProjection: ["panels", "windows"]
      },
      preconditions: ["The panel id must exist for the close to affect projected layout."],
      reversibility: {
        reversible: false,
        notes: "The event stream can be replayed, but there is no direct undo method yet."
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const panelInput = methodInput as { id?: string; reason?: string };
          if (!panelInput.id) {
            throw new Error("panels/close requires id");
          }
          return appendEvent({
            type: "panel.removed",
            payload: {
              id: panelInput.id,
              reason: panelInput.reason ?? "closed"
            },
            scope: { panelId: panelInput.id }
          });
        })
    })
  );
};
