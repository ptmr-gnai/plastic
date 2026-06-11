import { Effect } from "effect";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeModule } from "./runtime-method-context.js";

type RuntimeModuleSummary = {
  id: string;
  order: number;
};

export const createRuntimeModulesModule = (getModules: () => RuntimeModuleSummary[]): RuntimeModule => ({
  id: "runtime-modules",
  register: async ({ methods, runPromise }) => {
    await runPromise(
      methods.register({
        id: "runtime/modules",
        title: "Runtime modules",
        description: "Lists the shared runtime modules registered for this host, in startup order.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: {
          status: "available",
          notes: "Runtime module inventory is produced by the shared module plan in headed and headless modes."
        },
        inputSchema: noInputSchema,
        examples: [
          {
            title: "List runtime modules",
            input: {},
            verifyWith: { method: "plastic/selfTest", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () => Effect.succeed({
          count: getModules().length,
          items: getModules()
        })
      })
    );
  }
});
