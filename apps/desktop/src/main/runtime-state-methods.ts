import { Effect } from "effect";
import { buildPlasticState, type PlasticState } from "@plastic/core";
import { readRuntimeControlPlane } from "./agent-runtime-modules.js";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";

const runtimeStateAvailability = {
  status: "available" as const,
  notes: "State projection is a shared runtime primitive in headed and headless modes."
};

export const createRuntimeStateModule = (input: {
  decorateState?: (state: PlasticState) => unknown | Promise<unknown>;
}): RuntimeModule => ({
  id: "runtime-state",
  register: async ({ eventStore, methods, runPromise }: RuntimeMethodContext) => {
    await runPromise(
      methods.register({
        id: "plastic/state",
        title: "Plastic state",
        description: "Returns HATEOAS-style app state.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeStateAvailability,
        inputSchema: noInputSchema,
        examples: [
          {
            title: "Read current app state",
            input: {},
            verifyWith: { method: "plastic/methods", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () =>
          Effect.promise(async () => {
            const state = await runPromise(buildPlasticState(eventStore, methods));
            const events = await runPromise(eventStore.list());
            const stateWithControlPlane = {
              ...state,
              controlPlane: readRuntimeControlPlane(events)
            };
            return input.decorateState ? input.decorateState(stateWithControlPlane) : stateWithControlPlane;
          })
      })
    );
  }
});
