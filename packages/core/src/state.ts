import { Effect } from "effect";
import type { EventStore } from "./event-store.js";
import type { MethodRegistry, PlasticResource } from "./methods.js";

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
            { rel: "methods", href: "plastic/methods", method: "plastic/methods" }
          ],
          actions: [
            {
              id: "set-theme",
              title: "Set theme",
              method: "app/setTheme"
            }
          ]
        }
      ]
    };
  });
