import { Effect } from "effect";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeModule } from "./runtime-method-context.js";

const runtimeHostAvailability = {
  status: "available" as const,
  notes: "Host identity is a shared runtime primitive available in headed and headless modes."
};

export const createRuntimeHostModule = (input: {
  getHost: () => Record<string, unknown>;
  getDiagnostics: () => unknown;
}): RuntimeModule => ({
  id: "runtime-host",
  register: async ({ capabilities, methods, runPromise }) => {
    await runPromise(
      methods.register({
        id: "runtime/host",
        title: "Runtime host",
        description: "Returns the current Plastic host identity, control plane, capabilities, and diagnostics.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeHostAvailability,
        inputSchema: noInputSchema,
        examples: [
          {
            title: "Read host identity",
            input: {},
            verifyWith: { method: "runtime/capabilities", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () =>
          Effect.sync(() => ({
            ...input.getHost(),
            capabilities: {
              count: capabilities.list().length,
              items: capabilities.list()
            },
            diagnostics: input.getDiagnostics()
          }))
      })
    );
  }
});
