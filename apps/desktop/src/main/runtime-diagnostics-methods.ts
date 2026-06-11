import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeModule } from "./runtime-method-context.js";

const runtimeDiagnosticsAvailability = {
  status: "available" as const,
  notes: "Diagnostics are a shared runtime primitive backed by the current host."
};

export const createRuntimeDiagnosticsModule = (input: {
  getDiagnostics: () => unknown;
  plasticDir: string;
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
        inputSchema: noInputSchema,
        examples: [
          {
            title: "Read host diagnostics",
            input: {},
            verifyWith: { method: "plastic/state", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () => Effect.sync(input.getDiagnostics)
      })
    );

    await runPromise(
      methods.register({
        id: "runtime/auditStatus",
        title: "Runtime audit status",
        description: "Returns the latest persisted runtime unification audit summary, when one has been written.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeDiagnosticsAvailability,
        inputSchema: noInputSchema,
        examples: [
          {
            title: "Read latest runtime audit verdict",
            input: {},
            verifyWith: { method: "app/diagnostics", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () =>
          Effect.promise(async () => {
            const path = join(input.plasticDir, "tmp", "runtime-unification-audit.json");
            try {
              const summary = JSON.parse(await readFile(path, "utf8")) as unknown;
              return { available: true, path, summary };
            } catch (error) {
              const code = (error as { code?: string }).code;
              if (code === "ENOENT") {
                return { available: false, path, summary: null };
              }
              throw error;
            }
          })
      })
    );
  }
});
