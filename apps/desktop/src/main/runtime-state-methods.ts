import { Effect } from "effect";
import { buildPlasticState, type PlasticState } from "@plastic/core";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";

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
        handler: () =>
          Effect.promise(async () => {
            const state = await runPromise(buildPlasticState(eventStore, methods));
            return input.decorateState ? input.decorateState(state) : state;
          })
      })
    );
  }
});
