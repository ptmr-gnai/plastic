import { Effect } from "effect";
import type { RuntimeModule } from "./runtime-method-context.js";

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
        handler: () => Effect.sync(input.getDiagnostics)
      })
    );
  }
});
