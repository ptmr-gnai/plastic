import { Effect } from "effect";
import type { EventStore } from "./event-store.js";
import type { MethodRegistry, PlasticResource } from "./methods.js";
import { projectPanels, projectWindows } from "./panels.js";

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
      resources: [
        {
          id: "plastic",
          kind: "app",
          title: "Plastic",
          state: {
            eventCount: events.length,
            methodCount: registeredMethods.length
          },
          links: [
            { rel: "self", href: "plastic/state", method: "plastic/state" },
            { rel: "methods", href: "plastic/methods", method: "plastic/methods" },
            { rel: "events", href: "events/list", method: "events/list" },
            { rel: "panels", href: "panels/list", method: "panels/list" },
            { rel: "windows", href: "windows/list", method: "windows/list" }
          ],
          actions: [
            {
              id: "set-theme",
              title: "Set theme",
              method: "app/setTheme"
            },
            {
              id: "create-panel",
              title: "Create panel",
              method: "panels/create"
            },
            {
              id: "create-window",
              title: "Create window",
              method: "windows/create"
            }
          ]
        },
        {
          id: "panels",
          kind: "collection",
          title: "Panels",
          state: { count: panels.length, items: panels },
          links: [{ rel: "self", href: "panels/list", method: "panels/list" }],
          actions: [{ id: "create", title: "Create panel", method: "panels/create" }]
        },
        {
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
        },
        {
          id: "windows",
          kind: "collection",
          title: "Windows",
          state: { count: windows.length, items: windows },
          links: [{ rel: "self", href: "windows/list", method: "windows/list" }],
          actions: [{ id: "create", title: "Create window", method: "windows/create" }]
        }
      ]
    };
  });
