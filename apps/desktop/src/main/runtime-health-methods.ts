import { Effect } from "effect";
import {
  projectExtensions,
  projectPanels,
  projectWindows
} from "@plastic/core";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";

type HealthCheck = {
  id: string;
  ok: boolean;
  details?: unknown;
};

type HostHealthCheck = {
  id: string;
  run: () => Promise<unknown> | unknown;
};

const requiredRuntimeMethods = [
  "plastic/state",
  "plastic/methods",
  "methods/describe",
  "rpc/call",
  "runtime/capabilities",
  "panels/create",
  "events/list",
  "events/timeline",
  "plastic/selfTest"
];

const requiredRuntimeCapabilities = [
  "runtime.capabilities",
  "window.projection",
  "event.projection"
];

const runtimeHealthAvailability = {
  status: "available" as const,
  notes: "Self-test is a shared runtime health primitive in headed and headless modes."
};

export const createRuntimeHealthModule = (input: {
  description?: string;
  hostChecks?: HostHealthCheck[];
} = {}): RuntimeModule => ({
  id: "runtime-health",
  register: async ({ eventStore, methods, appendEvent, runPromise, capabilities }: RuntimeMethodContext) => {
    await runPromise(
      methods.register({
        id: "plastic/selfTest",
        title: "Plastic self-test",
        description: input.description ?? "Runs a fast control-plane health check for event store, projections, methods, and host capabilities.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeHealthAvailability,
        handler: () =>
          Effect.promise(async () => {
            const checks: HealthCheck[] = [];
            const record = (id: string, fn: () => Promise<unknown> | unknown) =>
              Promise.resolve()
                .then(fn)
                .then((details) => checks.push({ id, ok: true, details }))
                .catch((error) => checks.push({ id, ok: false, details: error instanceof Error ? error.message : String(error) }));

            const events = await runPromise(eventStore.list());
            const methodList = await runPromise(methods.list());
            await record("event-store:list", () => ({ count: events.length }));
            await record("methods:list", () => {
              const missingAvailability = methodList
                .filter((method) => !method.availability?.status)
                .map((method) => method.id);
              const methodIds = new Set(methodList.map((method) => method.id));
              const missingRequiredMethods = requiredRuntimeMethods.filter((id) => !methodIds.has(id));
              if (missingAvailability.length > 0) {
                throw new Error(`Methods missing availability: ${missingAvailability.join(", ")}`);
              }
              if (missingRequiredMethods.length > 0) {
                throw new Error(`Required methods missing: ${missingRequiredMethods.join(", ")}`);
              }
              return { count: methodList.length, missingAvailability, missingRequiredMethods };
            });
            await record("capabilities:list", () => {
              const capabilityList = capabilities.list();
              const capabilityIds = new Set(capabilityList.map((capability) => capability.id));
              const invalidStatuses = capabilityList
                .filter((capability) => !["available", "degraded", "unavailable"].includes(capability.status))
                .map((capability) => capability.id);
              const missingRequiredCapabilities = requiredRuntimeCapabilities.filter((id) => !capabilityIds.has(id));
              if (invalidStatuses.length > 0) {
                throw new Error(`Capabilities with invalid status: ${invalidStatuses.join(", ")}`);
              }
              if (missingRequiredCapabilities.length > 0) {
                throw new Error(`Required capabilities missing: ${missingRequiredCapabilities.join(", ")}`);
              }
              return { count: capabilityList.length, invalidStatuses, missingRequiredCapabilities };
            });
            await record("panels:project", () => ({ count: projectPanels(events).length }));
            await record("windows:project", () => ({ count: projectWindows(events).length }));
            await record("extensions:project", () => ({ count: projectExtensions(events).length }));
            for (const check of input.hostChecks ?? []) {
              await record(check.id, check.run);
            }

            const ok = checks.every((check) => check.ok);
            const event = await appendEvent({
              type: "plastic.self_test.completed",
              payload: { ok, checks }
            });
            return { ok, checks, eventId: event.id };
          })
      })
    );
  }
});
