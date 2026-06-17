import { Effect } from "effect";
import {
  buildPlasticState,
  projectExtensions,
  projectPanels,
  projectWindows,
  type PlasticMethod
} from "@plastic/core";
import { readRuntimeControlPlane } from "./agent-runtime-modules.js";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import { plasticSnapshotOutputSchema } from "./runtime-snapshot-schemas.js";
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
        outputSchema: plasticSnapshotOutputSchema,
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
            const registeredMethods = await runPromise(methods.call("plastic/methods", {})) as PlasticMethod[];
            const panels = projectPanels(events);
            const host = await input.getHostDetails();
            const state = await runPromise(buildPlasticState(eventStore, methods));

            return {
              app: host.app,
              build: host.build,
              runtime: host.runtime,
              codex: host.codex,
              controlPlane: readRuntimeControlPlane(events),
              methods: {
                count: registeredMethods.length,
                items: registeredMethods.map(toSerializableMethod)
              },
              panels,
              resources: state.resources,
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
                { rel: "host", href: "runtime/host", method: "runtime/host" },
                { rel: "capabilities", href: "runtime/capabilities", method: "runtime/capabilities" },
                { rel: "control-plane", href: "events/list", method: "events/list", input: { types: ["runtime.started"], limit: 1 } },
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

const toSerializableMethod = ({ handler: _handler, ...method }: PlasticMethod) => method;
