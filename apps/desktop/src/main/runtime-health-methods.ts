import { Effect } from "effect";
import {
  projectExtensions,
  projectPanels,
  projectWindows
} from "@plastic/core";
import {
  checkCapabilityRegistryHealth,
  checkRuntimeModuleMapHealth,
  checkMethodRegistryHealth
} from "./runtime-health-checks.js";
import { noInputSchema } from "./runtime-method-metadata.js";
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

const checkRuntimeAuditStatusHealth = (auditStatus: unknown) => {
  const verdict = (auditStatus as { verdict?: Record<string, unknown> })?.verdict;
  const status = verdict?.status;
  const actions = verdict?.actions;
  if (!["missing", "passed", "degraded", "failed"].includes(String(status))) {
    throw new Error("runtime/auditStatus returned an invalid verdict status");
  }
  if (!Array.isArray(actions)) {
    throw new Error("runtime/auditStatus verdict actions are missing");
  }
  return {
    available: (auditStatus as { available?: unknown }).available === true,
    status,
    diagnosisCode: (verdict?.diagnosis as { code?: unknown } | undefined)?.code ?? null,
    actions: actions.length
  };
};

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
        inputSchema: noInputSchema,
        examples: [
          {
            title: "Run runtime health checks",
            input: {},
            expectedEvents: ["plastic.self_test.completed"],
            verifyWith: { method: "events/list", input: { types: ["plastic.self_test.completed"], limit: 1 } }
          }
        ],
        effects: {
          durableEvents: ["plastic.self_test.completed"],
          mutatesProjection: ["events"]
        },
        reversibility: {
          reversible: false,
          notes: "The self-test result is appended to the event log; compensate by appending a later health event."
        },
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
            const capabilityList = capabilities.list();
            await record("event-store:list", () => ({ count: events.length }));
            await record("methods:list", () => checkMethodRegistryHealth(methodList, capabilityList));
            await record("capabilities:list", () => checkCapabilityRegistryHealth(capabilityList));
            await record("runtime-modules:map", async () =>
              checkRuntimeModuleMapHealth(await runPromise(methods.call("runtime/modules", {})))
            );
            await record("runtime-audit:status", async () =>
              checkRuntimeAuditStatusHealth(await runPromise(methods.call("runtime/auditStatus", {})))
            );
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
