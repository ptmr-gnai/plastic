import { Effect } from "effect";
import type { EventStore } from "./event-store.js";
import { projectExtensions, type PlasticExtension } from "./extensions.js";
import type { MethodRegistry, PlasticResource } from "./methods.js";
import { projectPanels, projectWindows, type PlasticPanel, type PlasticWindow } from "./panels.js";

export interface PlasticState {
  app: {
    name: "Plastic";
    theme: "light" | "dark";
  };
  events: {
    count: number;
    latest: string | null;
  };
  resources: PlasticResource[];
}

export const buildPlasticState = (
  eventStore: EventStore,
  methods: MethodRegistry
): Effect.Effect<PlasticState> =>
  Effect.gen(function* () {
    const events = yield* eventStore.list();
    const registeredMethods = yield* methods.list();
    const themeEvents = events.filter((event) => event.type === "theme.changed");
    const lastTheme = themeEvents.at(-1)?.payload as { theme?: "light" | "dark" } | undefined;
    const extensions = projectExtensions(events);
    const panels = projectPanels(events);
    const windows = projectWindows(events, panels);

    return {
      app: {
        name: "Plastic",
        theme: lastTheme?.theme ?? "light"
      },
      events: {
        count: events.length,
        latest: events.at(-1)?.id ?? null
      },
      resources: buildStateResources({
        eventCount: events.length,
        extensionItems: extensions,
        methodCount: registeredMethods.length,
        panelItems: panels,
        windowItems: windows
      })
    };
  });

const buildStateResources = (input: {
  eventCount: number;
  extensionItems: PlasticExtension[];
  methodCount: number;
  panelItems: PlasticPanel[];
  windowItems: PlasticWindow[];
}): PlasticResource[] => [
  plasticAppResource(input.eventCount, input.methodCount),
  runtimeHealthResource(),
  extensionCollectionResource(input.extensionItems),
  ...input.extensionItems.map(extensionResource),
  panelCollectionResource(input.panelItems),
  panelActionsResource(),
  ...input.panelItems.map(panelResource),
  windowCollectionResource(input.windowItems),
  ...input.windowItems.map(windowResource)
];

const eventMetaSchema = { type: "object", description: "Optional durable event metadata." };
const themeInputSchema = { type: "object", required: ["theme"], properties: { theme: { type: "string", enum: ["light", "dark"] } } };
const describeMethodInputSchema = { type: "object", required: ["id"], properties: { id: { type: "string" } } };
const eventsListInputSchema = {
  type: "object",
  properties: {
    after: { type: "string" },
    before: { type: "string" },
    limit: { oneOf: [{ type: "number" }, { const: "all" }] },
    types: { type: "array", items: { type: "string" } },
    includeDeltas: { type: "boolean" },
    scope: {
      type: "object",
      properties: {
        panelId: { type: "string" },
        agentId: { type: "string" },
        extensionId: { type: "string" },
        windowId: { type: "string" }
      }
    }
  }
};
const extensionIdInputSchema = { type: "object", required: ["id"], properties: { id: { type: "string" } } };
const panelCreateInputSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    kind: { type: "string" },
    extensionId: { type: "string" },
    rendererId: { type: "string" },
    subtitle: { type: "string" },
    body: { type: "string" },
    windowId: { type: "string" },
    order: { type: "number" },
    meta: eventMetaSchema
  }
};
const panelRenameInputSchema = { type: "object", required: ["id", "title"], properties: { id: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" }, meta: eventMetaSchema } };
const panelMoveInputSchema = { type: "object", required: ["id"], properties: { id: { type: "string" }, windowId: { type: "string" }, order: { type: "number" }, meta: eventMetaSchema } };
const panelRemoveInputSchema = { type: "object", required: ["id"], properties: { id: { type: "string" }, reason: { type: "string" }, meta: eventMetaSchema } };
const windowCreateInputSchema = { type: "object", properties: { title: { type: "string" } } };
const extensionScanInputSchema = { type: "object", properties: { meta: eventMetaSchema } };
const extensionRegisterPanelInputSchema = { type: "object", required: ["extensionId"], properties: { extensionId: { type: "string" } } };
const chatSendInputSchema = { type: "object", required: ["chatId", "content"], properties: { chatId: { type: "string" }, content: { type: "string" } } };

const plasticAppResource = (eventCount: number, methodCount: number): PlasticResource => ({
  id: "plastic",
  kind: "app",
  title: "Plastic",
  state: { eventCount, methodCount },
  links: [
    { rel: "self", href: "plastic/state", method: "plastic/state" },
    { rel: "methods", href: "plastic/methods", method: "plastic/methods" },
    { rel: "describe-method", href: "methods/describe", method: "methods/describe", inputSchema: describeMethodInputSchema },
    { rel: "events", href: "events/list", method: "events/list", inputSchema: eventsListInputSchema },
    { rel: "extensions", href: "extensions/list", method: "extensions/list" },
    { rel: "panels", href: "panels/list", method: "panels/list" },
    { rel: "windows", href: "windows/list", method: "windows/list" },
    { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" }
  ],
  actions: [
    { id: "set-theme", title: "Set theme", method: "app/setTheme", inputSchema: themeInputSchema },
    { id: "create-panel", title: "Create panel", method: "panels/create", inputSchema: panelCreateInputSchema },
    { id: "create-window", title: "Create window", method: "windows/create", inputSchema: windowCreateInputSchema },
    { id: "scan-extensions", title: "Scan extensions", method: "extensions/scan", inputSchema: extensionScanInputSchema },
    {
      id: "describe-method",
      title: "Describe method",
      method: "methods/describe",
      inputSchema: describeMethodInputSchema,
      description: "Read schema, examples, effects, and verification hints for one RPC method."
    }
  ]
});

const runtimeHealthResource = (): PlasticResource => ({
  id: "runtime-health",
  kind: "service",
  title: "Runtime health",
  state: {},
  links: [{ rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" }],
  actions: [{ id: "run-self-test", title: "Run Plastic self-test", method: "plastic/selfTest" }]
});

const extensionCollectionResource = (items: PlasticExtension[]): PlasticResource => ({
  id: "extensions",
  kind: "collection",
  title: "Extensions",
  state: { count: items.length, items },
  links: [{ rel: "self", href: "extensions/list", method: "extensions/list" }],
  actions: [
    { id: "scan", title: "Scan extensions", method: "extensions/scan", inputSchema: extensionScanInputSchema },
    { id: "get", title: "Get extension", method: "extensions/get", inputSchema: extensionIdInputSchema },
    { id: "register-panel", title: "Register extension panel", method: "extensions/registerPanel", inputSchema: extensionRegisterPanelInputSchema }
  ]
});

const extensionResource = (extension: PlasticExtension): PlasticResource<PlasticExtension> => ({
  id: `extension:${extension.id}`,
  kind: "extension",
  title: extension.title,
  state: extension,
  links: [
    { rel: "self", href: "extensions/get", method: "extensions/get", target: extension.id, input: { id: extension.id } },
    { rel: "collection", href: "extensions/list", method: "extensions/list" },
    { rel: "timeline", href: "events/timeline", method: "events/timeline", target: extension.id, input: { scope: { extensionId: extension.id }, limit: 12 } },
    ...extension.methods.map((method) => ({ rel: "method", href: "methods/describe", method: "methods/describe", target: method.id, input: { id: method.id } }))
  ],
  actions: [
    { id: "get-extension", title: "Get extension", method: "extensions/get", input: { id: extension.id } },
    { id: "activate-extension", title: "Activate extension", method: "extensions/activate", input: { extensionId: extension.id } },
    { id: "verify-extension", title: "Verify extension", method: "extensions/verify", input: { extensionId: extension.id } },
    ...(extension.panels.length > 0 ? [{ id: "register-panel", title: "Register extension panel", method: "extensions/registerPanel", input: { extensionId: extension.id } }] : []),
    ...(extension.source === "bundled" ? [{ id: "fork-bundled", title: "Fork bundled extension", method: "extensions/forkBundled", input: { extensionId: extension.id } }] : [])
  ]
});

const panelCollectionResource = (items: PlasticPanel[]): PlasticResource => ({
  id: "panels",
  kind: "collection",
  title: "Panels",
  state: { count: items.length, items },
  links: [{ rel: "self", href: "panels/list", method: "panels/list" }],
  actions: [{ id: "create", title: "Create panel", method: "panels/create", inputSchema: panelCreateInputSchema }]
});

const panelActionsResource = (): PlasticResource => ({
  id: "panel-actions",
  kind: "action-set",
  title: "Panel controls",
  state: {},
  links: [{ rel: "panels", href: "panels/list", method: "panels/list" }],
  actions: [
    { id: "rename", title: "Rename panel", method: "panels/rename", inputSchema: panelRenameInputSchema },
    { id: "move", title: "Move panel", method: "panels/move", inputSchema: panelMoveInputSchema },
    { id: "remove", title: "Remove panel", method: "panels/remove", inputSchema: panelRemoveInputSchema }
  ]
});

const panelResource = (panel: PlasticPanel): PlasticResource<PlasticPanel> => ({
  id: `panel:${panel.id}`,
  kind: "panel",
  title: panel.title,
  state: panel,
  links: [
    { rel: "self", href: "panels/get", method: "panels/get", target: panel.id, input: { id: panel.id } },
    { rel: "collection", href: "panels/list", method: "panels/list" },
    { rel: "extension", href: "extensions/get", method: "extensions/get", target: panel.extensionId, input: { id: panel.extensionId } },
    ...(panel.windowId
      ? [{ rel: "window-collection", href: "windows/list", method: "windows/list", target: panel.windowId }]
      : [])
  ],
  actions: [
    { id: "get-panel", title: "Get panel", method: "panels/get", input: { id: panel.id } },
    { id: "rename-panel", title: "Rename panel", method: "panels/rename", input: { id: panel.id }, inputSchema: panelRenameInputSchema },
    { id: "move-panel", title: "Move panel", method: "panels/move", input: { id: panel.id }, inputSchema: panelMoveInputSchema },
    { id: "remove-panel", title: "Remove panel", method: "panels/remove", input: { id: panel.id } },
    ...(panel.kind === "chat"
      ? [
          { id: "read-chat-messages", title: "Read chat messages", method: "chats/messages", input: { chatId: panel.id } },
          { id: "send-chat-message", title: "Send chat message", method: "chats/sendToCodex", input: { chatId: panel.id }, inputSchema: chatSendInputSchema }
        ]
      : [])
  ]
});

const windowCollectionResource = (items: PlasticWindow[]): PlasticResource => ({
  id: "windows",
  kind: "collection",
  title: "Windows",
  state: { count: items.length, items },
  links: [{ rel: "self", href: "windows/list", method: "windows/list" }],
  actions: [{ id: "create", title: "Create window", method: "windows/create", inputSchema: windowCreateInputSchema }]
});

const windowResource = (window: PlasticWindow): PlasticResource<PlasticWindow> => ({
  id: `window:${window.id}`,
  kind: "window",
  title: window.title,
  state: window,
  links: [
    { rel: "collection", href: "windows/list", method: "windows/list" },
    { rel: "timeline", href: "events/timeline", method: "events/timeline", target: window.id, input: { scope: { windowId: window.id }, limit: 12 } }
  ],
  actions: [
    { id: "list-windows", title: "List windows", method: "windows/list" },
    ...window.panelIds.map((panelId) => ({
      id: `focus-panel:${panelId}`,
      title: `Focus panel ${panelId}`,
      method: "windows/focusPanel",
      input: { panelId }
    })),
    ...window.panelIds.map((panelId) => ({
      id: `scroll-panel:${panelId}`,
      title: `Scroll to panel ${panelId}`,
      method: "windows/scrollToRef",
      input: { ref: `panel:${panelId}` }
    }))
  ]
});
