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
  panelCollectionResource(input.panelItems),
  panelActionsResource(),
  windowCollectionResource(input.windowItems)
];

const plasticAppResource = (eventCount: number, methodCount: number): PlasticResource => ({
  id: "plastic",
  kind: "app",
  title: "Plastic",
  state: { eventCount, methodCount },
  links: [
    { rel: "self", href: "plastic/state", method: "plastic/state" },
    { rel: "methods", href: "plastic/methods", method: "plastic/methods" },
    { rel: "describe-method", href: "methods/describe", method: "methods/describe" },
    { rel: "events", href: "events/list", method: "events/list" },
    { rel: "extensions", href: "extensions/list", method: "extensions/list" },
    { rel: "panels", href: "panels/list", method: "panels/list" },
    { rel: "windows", href: "windows/list", method: "windows/list" },
    { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" }
  ],
  actions: [
    { id: "set-theme", title: "Set theme", method: "app/setTheme" },
    { id: "create-panel", title: "Create panel", method: "panels/create" },
    { id: "create-window", title: "Create window", method: "windows/create" },
    { id: "scan-extensions", title: "Scan extensions", method: "extensions/scan" },
    {
      id: "describe-method",
      title: "Describe method",
      method: "methods/describe",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      },
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
    { id: "scan", title: "Scan extensions", method: "extensions/scan" },
    { id: "get", title: "Get extension", method: "extensions/get" },
    { id: "register-panel", title: "Register extension panel", method: "extensions/registerPanel" }
  ]
});

const panelCollectionResource = (items: PlasticPanel[]): PlasticResource => ({
  id: "panels",
  kind: "collection",
  title: "Panels",
  state: { count: items.length, items },
  links: [{ rel: "self", href: "panels/list", method: "panels/list" }],
  actions: [{ id: "create", title: "Create panel", method: "panels/create" }]
});

const panelActionsResource = (): PlasticResource => ({
  id: "panel-actions",
  kind: "action-set",
  title: "Panel controls",
  state: {},
  links: [{ rel: "panels", href: "panels/list", method: "panels/list" }],
  actions: [
    { id: "rename", title: "Rename panel", method: "panels/rename" },
    { id: "move", title: "Move panel", method: "panels/move" },
    { id: "remove", title: "Remove panel", method: "panels/remove" }
  ]
});

const windowCollectionResource = (items: PlasticWindow[]): PlasticResource => ({
  id: "windows",
  kind: "collection",
  title: "Windows",
  state: { count: items.length, items },
  links: [{ rel: "self", href: "windows/list", method: "windows/list" }],
  actions: [{ id: "create", title: "Create window", method: "windows/create" }]
});
