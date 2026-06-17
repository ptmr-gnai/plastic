import { Effect } from "effect";
import type { PlasticMethod } from "@plastic/core";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import { runtimeModulesOutputSchema } from "./runtime-module-schemas.js";
import type { RuntimeModule } from "./runtime-method-context.js";

type RuntimeModuleSummary = {
  id: string;
  order: number;
  methodIds?: string[];
};

type RuntimeModuleAvailabilitySummary = {
  available: number;
  degraded: number;
  unavailable: number;
  requiredCapabilities: string[];
  missingCapabilities: string[];
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
        outputSchema: runtimeModulesOutputSchema,
        examples: [
          {
            title: "List runtime modules",
            input: {},
            verifyWith: { method: "plastic/selfTest", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () =>
          Effect.promise(async () => {
            const registeredMethods = await runPromise(methods.list());
            const items = getModules().map((module) => ({
              ...module,
              availability: summarizeModuleAvailability(module, registeredMethods)
            }));
            return {
              count: items.length,
              items
            };
          })
      })
    );
  }
});

const summarizeModuleAvailability = (
  module: RuntimeModuleSummary,
  methods: PlasticMethod[]
): RuntimeModuleAvailabilitySummary => {
  const moduleMethods = methods.filter((method) => module.methodIds?.includes(method.id));
  const requiredCapabilities = new Set<string>();
  const missingCapabilities = new Set<string>();
  const counts = { available: 0, degraded: 0, unavailable: 0 };
  for (const method of moduleMethods) {
    const status = method.availability?.status ?? "unavailable";
    counts[status] += 1;
    for (const capability of method.availability?.requiredCapabilities ?? []) {
      requiredCapabilities.add(capability);
    }
    for (const capability of method.availability?.missingCapabilities ?? []) {
      missingCapabilities.add(capability);
    }
  }
  return {
    ...counts,
    requiredCapabilities: [...requiredCapabilities].sort(),
    missingCapabilities: [...missingCapabilities].sort()
  };
};
