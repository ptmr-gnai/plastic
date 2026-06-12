import { Effect } from "effect";
import {
  projectExtensions,
  projectPanels,
  projectWindows,
  type PlasticExtension,
  type PlasticEvent
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

const requiredExtensionMethods = [
  "extensions/scan",
  "extensions/list",
  "extensions/get",
  "extensions/verify",
  "extensions/verifyAll",
  "extensions/verificationStatus",
  "extensions/activate",
  "extensions/forkBundled",
  "extensions/registerPanel",
  "extensions/scaffold"
];

const checkRuntimeAuditStatusHealth = (auditStatus: unknown) => {
  const verdict = (auditStatus as { verdict?: Record<string, unknown> })?.verdict;
  const status = verdict?.status;
  const actions = verdict?.actions;
  const diagnosis = asRecord(verdict?.diagnosis);
  const failureSummary = asRecord(verdict?.failureSummary);
  const firstFailure = failureSummary.first === null ? null : asRecord(failureSummary.first);
  if (!["missing", "passed", "degraded", "failed"].includes(String(status))) {
    throw new Error("runtime/auditStatus returned an invalid verdict status");
  }
  if (typeof diagnosis.code !== "string" || typeof diagnosis.summary !== "string") {
    throw new Error("runtime/auditStatus verdict diagnosis is incomplete");
  }
  if (
    typeof failureSummary.count !== "number"
    || !Array.isArray(failureSummary.ids)
    || !Array.isArray(failureSummary.blockingIds)
    || (firstFailure !== null && typeof firstFailure.id !== "string")
  ) {
    throw new Error("runtime/auditStatus verdict failure summary is incomplete");
  }
  if (!Array.isArray(actions)) {
    throw new Error("runtime/auditStatus verdict actions are missing");
  }
  return {
    available: (auditStatus as { available?: unknown }).available === true,
    status,
    diagnosisCode: diagnosis.code,
    failureCount: failureSummary.count,
    failureIds: failureSummary.ids.filter((id): id is string => typeof id === "string"),
    blockingFailureIds: failureSummary.blockingIds.filter((id): id is string => typeof id === "string"),
    firstFailureId: firstFailure?.id ?? null,
    actions: actions.length
  };
};

const checkAgentTransportsHealth = (events: PlasticEvent[]) => {
  const latestStarted = [...events].reverse().find((event) => event.type === "runtime.started");
  const host = asRecord(asRecord(latestStarted?.payload).host);
  const transports = Array.isArray(host.agentTransports) ? host.agentTransports.map(asRecord) : [];
  const http = transports.find((transport) => transport.id === "http-rpc");
  const mcp = transports.find((transport) => transport.id === "mcp-stdio");
  if (!http || http.status !== "available" || http.methodRegistry !== "shared") {
    throw new Error("runtime.started missing shared HTTP RPC agent transport");
  }
  if (!mcp || mcp.status !== "available" || mcp.methodRegistry !== "shared") {
    throw new Error("runtime.started missing shared MCP stdio agent transport");
  }
  if (!Array.isArray(http.actions) || !http.actions.some((action) => asRecord(action).id === "call-plastic-rpc")) {
    throw new Error("HTTP RPC agent transport missing call action");
  }
  if (!Array.isArray(mcp.tools) || !mcp.tools.some((tool) => asRecord(tool).name === "plastic_rpc")) {
    throw new Error("MCP stdio agent transport missing plastic_rpc tool");
  }
  if (!Array.isArray(mcp.actions) || !mcp.actions.some((action) => asRecord(action).tool === "plastic_rpc")) {
    throw new Error("MCP stdio agent transport missing plastic_rpc action");
  }
  return {
    count: transports.length,
    ids: transports.map((transport) => transport.id),
    mcpTool: "plastic_rpc"
  };
};

const checkRuntimeStartedDescriptorHealth = (events: PlasticEvent[]) => {
  const latestStarted = [...events].reverse().find((event) => event.type === "runtime.started");
  const payload = asRecord(latestStarted?.payload);
  const host = asRecord(payload.host);
  const controlPlane = asRecord(payload.controlPlane);
  const runtimeControlPlane = asRecord(controlPlane.runtime);
  const buildControlPlane = asRecord(controlPlane.build);
  const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.map(asRecord) : [];
  const modules = Array.isArray(payload.modules) ? payload.modules.map(asRecord) : [];
  if (!latestStarted) {
    throw new Error("runtime.started event is missing");
  }
  if (host.hostBase === undefined || !Array.isArray(host.agentTransports)) {
    throw new Error("runtime.started host descriptor is incomplete");
  }
  if (runtimeControlPlane.transport !== "http" || buildControlPlane.transport !== "http") {
    throw new Error("runtime.started control plane must expose runtime and build HTTP transports");
  }
  if (capabilities.length === 0 || !capabilities.every((capability) => typeof capability.id === "string")) {
    throw new Error("runtime.started capability inventory is incomplete");
  }
  if (modules.length === 0 || !modules.every((module) => typeof module.id === "string" && Array.isArray(module.methodIds))) {
    throw new Error("runtime.started module inventory is incomplete");
  }
  return {
    eventId: latestStarted.id,
    runtimeTransport: runtimeControlPlane.transport,
    buildTransport: buildControlPlane.transport,
    capabilities: capabilities.length,
    modules: modules.length,
    agentTransports: host.agentTransports.length
  };
};

const checkExtensionRuntimeHealth = (extensions: PlasticExtension[], methodIds: Set<string>) => {
  const bundled = extensions.filter((extension) => extension.source === "bundled");
  const missingMethods = requiredExtensionMethods.filter((id) => !methodIds.has(id));
  if (bundled.length === 0) {
    throw new Error("No bundled extensions are projected");
  }
  if (!bundled.some((extension) => extension.id === "plastic.chat")) {
    throw new Error("Bundled chat extension is not projected");
  }
  if (missingMethods.length > 0) {
    throw new Error(`Extension runtime methods missing: ${missingMethods.join(", ")}`);
  }
  return {
    count: extensions.length,
    bundled: bundled.length,
    bundledIds: bundled.map((extension) => extension.id),
    requiredMethods: requiredExtensionMethods.length
  };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

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
            await record("event-store:list", () => ({ count: events.length }));
            await record("methods:list", () => checkMethodRegistryHealth(methodList, capabilityList));
            await record("capabilities:list", () => checkCapabilityRegistryHealth(capabilityList));
            await record("runtime-modules:map", async () =>
              checkRuntimeModuleMapHealth(await runPromise(methods.call("runtime/modules", {})))
            );
            await record("runtime-started:descriptor", () => checkRuntimeStartedDescriptorHealth(events));
            await record("runtime-audit:status", async () =>
              checkRuntimeAuditStatusHealth(await runPromise(methods.call("runtime/auditStatus", {})))
            );
            await record("agent-transports:affordances", () => checkAgentTransportsHealth(events));
            await record("panels:project", () => ({ count: projectPanels(events).length }));
            await record("windows:project", () => ({ count: projectWindows(events).length }));
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
