import { Effect } from "effect";
import {
  projectExtensions,
  projectPanels,
  projectWindows
} from "@plastic/core";
import {
  checkCapabilityRegistryHealth,
  checkMethodAffordanceHealth,
  checkMethodAvailabilityCapabilityHealth,
  checkRuntimeModuleCoverageHealth,
  checkRuntimeModuleMapHealth,
  checkRuntimeStartedCapabilityParityHealth,
  checkRuntimeStartedModuleParityHealth,
  checkMethodRegistryHealth
} from "./runtime-health-checks.js";
import {
  checkAgentOrientationHealth,
  checkAgentTransportsHealth,
  checkBuildStatusHealth,
  checkCapabilityProjectionHealth,
  checkExtensionRuntimeHealth,
  checkPanelRuntimeHealth,
  checkProjectionDiscoveryHealth,
  checkRuntimeAuditStatusHealth,
  checkRuntimeStartedDescriptorHealth,
  checkWindowRuntimeHealth
} from "./runtime-health-self-test-checks.js";
import { checkRuntimeHostIdentityHealth } from "./runtime-health-host-checks.js";
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
            const methodIds = new Set(methodList.map((method) => method.id));
            const capabilityList = capabilities.list();
            const projectedExtensions = projectExtensions(events);
            const projectedPanels = projectPanels(events);
            const projectedWindows = projectWindows(events, projectedPanels);
            await record("event-store:list", () => ({ count: events.length }));
            await record("methods:list", () => checkMethodRegistryHealth(methodList, capabilityList));
            await record("methods:affordances", () => checkMethodAffordanceHealth(methodList));
            await record("methods:availability-capabilities", () => checkMethodAvailabilityCapabilityHealth(methodList, capabilityList));
            await record("capabilities:list", () => checkCapabilityRegistryHealth(capabilityList));
            await record("runtime-started:capabilities", () => checkRuntimeStartedCapabilityParityHealth(capabilityList, events));
            await record("capabilities:projection", async () =>
              checkCapabilityProjectionHealth(capabilityList, await runPromise(methods.call("runtime/capabilities", {})), events)
            );
            await record("projections:discovery", async () =>
              checkProjectionDiscoveryHealth(
                await runPromise(methods.call("plastic/state", {})),
                await runPromise(methods.call("plastic/snapshot", {})),
                methodList
              )
            );
            await record("build:surface", async () =>
              checkBuildStatusHealth(await runPromise(methods.call("build/status", {})))
            );
            const runtimeModules = await runPromise(methods.call("runtime/modules", {}));
            await record("runtime-modules:map", async () => checkRuntimeModuleMapHealth(runtimeModules));
            await record("runtime-modules:coverage", () => checkRuntimeModuleCoverageHealth(runtimeModules, methodList));
            await record("runtime-started:modules", () => checkRuntimeStartedModuleParityHealth(runtimeModules, events));
            await record("runtime-started:descriptor", () => checkRuntimeStartedDescriptorHealth(events));
            await record("runtime-host:identity", async () => checkRuntimeHostIdentityHealth(await runPromise(methods.call("runtime/host", {})), events));
            await record("runtime-audit:status", async () => checkRuntimeAuditStatusHealth(await runPromise(methods.call("runtime/auditStatus", {}))));
            await record("agent-orientation:packets", async () =>
              checkAgentOrientationHealth(
                await runPromise(methods.call("agent/workbench", { limit: 3 })),
                await runPromise(methods.call("agent/orient", { panelId: projectedPanels[0]?.id })), methodIds
              )
            );
            await record("agent-transports:affordances", () => checkAgentTransportsHealth(events));
            await record("panels:project", () => checkPanelRuntimeHealth(projectedPanels, projectedExtensions, methodIds));
            await record("windows:project", () => checkWindowRuntimeHealth(projectedWindows, projectedPanels, methodList));
            await record("extensions:project", () => checkExtensionRuntimeHealth(projectedExtensions, methodIds));
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
