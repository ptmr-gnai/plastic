import { Effect } from "effect";
import type { RuntimeModule } from "./runtime-method-context.js";

const runtimeDiagnosticsAvailability = {
  status: "available" as const,
  notes: "Diagnostics are a shared runtime primitive backed by the current host."
};

export const createRuntimeDiagnosticsModule = (input: {
  getDiagnostics: () => unknown;
}): RuntimeModule => ({
  id: "runtime-diagnostics",
  register: async ({ methods, runPromise }) => {
    await runPromise(
      methods.register({
        id: "app/diagnostics",
        title: "App diagnostics",
        description: "Returns runtime host diagnostics for the current Plastic process.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeDiagnosticsAvailability,
        handler: () => Effect.sync(input.getDiagnostics)
      })
    );
  }
});
