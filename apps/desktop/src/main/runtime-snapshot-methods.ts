import { Effect } from "effect";
import {
  projectExtensions,
  projectPanels,
  projectWindows
} from "@plastic/core";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";

const runtimeSnapshotAvailability = {
  status: "available" as const,
  notes: "Snapshot projection is a shared runtime primitive in headed and headless modes."
};

type SnapshotHostDetails = {
  app: Record<string, unknown>;
  build: unknown;
  runtime: unknown;
  codex: unknown;
  visibleRefs: unknown;
};

export const createRuntimeSnapshotModule = (input: {
  getHostDetails: () => Promise<SnapshotHostDetails> | SnapshotHostDetails;
}): RuntimeModule => ({
  id: "runtime-snapshot",
  register: async ({ eventStore, methods, runPromise }: RuntimeMethodContext) => {
    await runPromise(
      methods.register({
        id: "plastic/snapshot",
        title: "Plastic snapshot",
        description: "Returns a high-signal observable snapshot for agents: app, build, methods, panels, windows, extensions, visible refs, Codex, and recent events.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeSnapshotAvailability,
        inputSchema: noInputSchema,
        examples: [
          {
            title: "Read agent workbench snapshot",
            input: {},
            verifyWith: { method: "plastic/state", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () =>
          Effect.promise(async () => {
            const events = await runPromise(eventStore.list());
            const registeredMethods = await runPromise(methods.list());
            const panels = projectPanels(events);
            const host = await input.getHostDetails();

            return {
              app: host.app,
              build: host.build,
              runtime: host.runtime,
              codex: host.codex,
              methods: {
                count: registeredMethods.length,
                items: registeredMethods.map((method) => ({
                  id: method.id,
                  title: method.title,
                  owner: method.owner,
                  description: method.description,
                  availability: method.availability,
                  links: method.links ?? []
                }))
              },
              panels,
              windows: projectWindows(events, panels),
              extensions: projectExtensions(events),
              visibleRefs: host.visibleRefs,
              events: {
                count: events.length,
                latest: events.at(-1) ?? null,
                recent: events.slice(-30)
              },
              links: [
                { rel: "state", href: "plastic/state", method: "plastic/state" },
                { rel: "methods", href: "plastic/methods", method: "plastic/methods" },
                { rel: "capabilities", href: "runtime/capabilities", method: "runtime/capabilities" },
                { rel: "events", href: "events/list", method: "events/list" },
                { rel: "visible-refs", href: "deixis/listVisibleRefs", method: "deixis/listVisibleRefs" },
                { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" }
              ]
            };
          })
      })
    );
  }
});
