import { Effect } from "effect";
import {
  projectExtensions,
  projectPanels,
  projectWindows,
  type PlasticExtension,
  type PlasticPanel,
  type PlasticWindow,
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

const requiredPanelMethods = [
  "panels/list",
  "panels/get",
  "panels/create",
  "panels/rename",
  "panels/move",
  "panels/remove",
  "panels/close",
  "panels/sendMessage",
  "panels/listMessages",
  "panels/markMessageRead",
  "panels/mailboxes"
];

const requiredWindowMethods = [
  "windows/list",
  "windows/create",
  "windows/focusPanel",
  "windows/scrollToRef",
  "windows/screenshot"
];

const requiredAgentActionMethods = [
  "runtime/host",
  "runtime/auditStatus",
  "runtime/auditActionPlan",
  "runtime/runAuditAction"
];

const requiredAgentLinkMethods = [
  "runtime/host",
  "runtime/modules",
  "runtime/auditStatus",
  "runtime/auditActionPlan",
  "runtime/runAuditAction"
];

const checkBuildStatusHealth = (buildStatus: unknown) => {
  const status = asRecord(buildStatus);
  const hostBase = asRecord(status.hostBase);
  const controlPlane = asRecord(status.controlPlane);
  const runtimeControlPlane = asRecord(controlPlane.runtime);
  const buildControlPlane = asRecord(controlPlane.build);
  const transports = Array.isArray(status.agentTransports) ? status.agentTransports.map(asRecord) : [];
  if (status.status !== "running") {
    throw new Error("build/status did not report running");
  }
  if (hostBase.id !== "runtime-host-base" || hostBase.version !== 1) {
    throw new Error("build/status missing shared host base marker");
  }
  if (runtimeControlPlane.transport !== "http" || buildControlPlane.transport !== "http") {
    throw new Error("build/status missing runtime/build HTTP control plane");
  }
  if (typeof status.workspaceDir !== "string" || typeof status.eventPath !== "string") {
    throw new Error("build/status missing workspace paths");
  }
  if (!transports.some((transport) => transport.id === "http-rpc") || !transports.some((transport) => transport.id === "mcp-stdio")) {
    throw new Error("build/status missing agent transport affordances");
  }
  return {
    service: status.service ?? null,
    mode: status.mode ?? null,
    runtimeTransport: runtimeControlPlane.transport,
    buildTransport: buildControlPlane.transport,
    agentTransports: transports.length
  };
};

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

const checkPanelRuntimeHealth = (panels: PlasticPanel[], extensions: PlasticExtension[], methodIds: Set<string>) => {
  const extensionIds = new Set(extensions.map((extension) => extension.id));
  const extensionBackedPanels = panels.filter((panel) => extensionIds.has(panel.extensionId));
  const missingMethods = requiredPanelMethods.filter((id) => !methodIds.has(id));
  if (panels.length === 0) {
    throw new Error("No panels are projected");
  }
  if (extensionBackedPanels.length === 0) {
    throw new Error("No extension-backed panels are projected");
  }
  if (missingMethods.length > 0) {
    throw new Error(`Panel runtime methods missing: ${missingMethods.join(", ")}`);
  }
  return {
    count: panels.length,
    extensionBacked: extensionBackedPanels.length,
    extensionBackedIds: extensionBackedPanels.map((panel) => panel.id),
    requiredMethods: requiredPanelMethods.length
  };
};

const checkWindowRuntimeHealth = (windows: PlasticWindow[], panels: PlasticPanel[], methodList: Array<{ id: string; availability?: { status?: string; missingCapabilities?: string[] } }>) => {
  const byId = new Map(methodList.map((method) => [method.id, method]));
  const missingMethods = requiredWindowMethods.filter((id) => !byId.has(id));
  const windowsList = byId.get("windows/list");
  if (windows.length === 0) {
    throw new Error("No windows are projected");
  }
  if (!windows.every((window) => Array.isArray(window.panelIds))) {
    throw new Error("Projected windows must include panelIds");
  }
  if (panels.length > 0 && windows.every((window) => window.panelIds.length === 0)) {
    throw new Error("Projected windows are not connected to projected panels");
  }
  if (missingMethods.length > 0) {
    throw new Error(`Window runtime methods missing: ${missingMethods.join(", ")}`);
  }
  if (!["available", "degraded"].includes(String(windowsList?.availability?.status))) {
    throw new Error("windows/list must be available or degraded, not unavailable");
  }
  return {
    count: windows.length,
    open: windows.filter((window) => window.open).length,
    panelSlots: windows.reduce((count, window) => count + window.panelIds.length, 0),
    windowsListStatus: windowsList?.availability?.status ?? null,
    missingCapabilities: windowsList?.availability?.missingCapabilities ?? [],
    requiredMethods: requiredWindowMethods.length
  };
};

const checkAgentOrientationHealth = (workbench: unknown, orientation: unknown) => {
  const workbenchRecord = asRecord(workbench);
  const orientationRecord = asRecord(orientation);
  const control = asRecord(workbenchRecord.control);
  const capabilities = asRecord(orientationRecord.capabilities);
  const workbenchActions = Array.isArray(control.recommendedActions) ? control.recommendedActions.map(asRecord) : [];
  const orientationActions = Array.isArray(capabilities.recommendedActions) ? capabilities.recommendedActions.map(asRecord) : [];
  const orientationLinks = Array.isArray(capabilities.links) ? capabilities.links.map(asRecord) : [];
  const agentTransports = Array.isArray(control.agentTransports) ? control.agentTransports.map(asRecord) : [];
  const auditStatus = asRecord(control.auditStatus);
  const failureSummary = asRecord(auditStatus.failureSummary);
  const controlPlane = asRecord(control.controlPlane);
  const runtimeControlPlane = asRecord(controlPlane.runtime);
  const buildControlPlane = asRecord(controlPlane.build);
  const missingWorkbenchActions = requiredAgentActionMethods.filter((method) =>
    !workbenchActions.some((action) => action.method === method)
  );
  const missingOrientationActions = requiredAgentActionMethods.filter((method) =>
    !orientationActions.some((action) => action.method === method)
  );
  const missingOrientationLinks = requiredAgentLinkMethods.filter((method) =>
    !orientationLinks.some((link) => link.method === method)
  );
  if (runtimeControlPlane.transport !== "http" || buildControlPlane.transport !== "http") {
    throw new Error("agent/workbench missing shared runtime/build control plane");
  }
  if (!agentTransports.some((transport) => transport.id === "http-rpc") || !agentTransports.some((transport) => transport.id === "mcp-stdio")) {
    throw new Error("agent/workbench missing HTTP RPC or MCP transport affordance");
  }
  if (typeof auditStatus.verdict !== "string" || typeof failureSummary.count !== "number") {
    throw new Error("agent/workbench missing compact audit status");
  }
  if (missingWorkbenchActions.length > 0) {
    throw new Error(`agent/workbench missing actions: ${missingWorkbenchActions.join(", ")}`);
  }
  if (missingOrientationActions.length > 0) {
    throw new Error(`agent/orient missing actions: ${missingOrientationActions.join(", ")}`);
  }
  if (missingOrientationLinks.length > 0) {
    throw new Error(`agent/orient missing links: ${missingOrientationLinks.join(", ")}`);
  }
  return {
    workbenchActions: workbenchActions.length,
    orientationActions: orientationActions.length,
    orientationLinks: orientationLinks.length,
    agentTransports: agentTransports.length,
    auditVerdict: auditStatus.verdict,
    auditFailureCount: failureSummary.count
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
            const projectedPanels = projectPanels(events);
            const projectedWindows = projectWindows(events, projectedPanels);
            await record("event-store:list", () => ({ count: events.length }));
            await record("methods:list", () => checkMethodRegistryHealth(methodList, capabilityList));
            await record("capabilities:list", () => checkCapabilityRegistryHealth(capabilityList));
            await record("build:surface", async () =>
              checkBuildStatusHealth(await runPromise(methods.call("build/status", {})))
            );
            await record("runtime-modules:map", async () =>
              checkRuntimeModuleMapHealth(await runPromise(methods.call("runtime/modules", {})))
            );
            await record("runtime-started:descriptor", () => checkRuntimeStartedDescriptorHealth(events));
            await record("runtime-audit:status", async () =>
              checkRuntimeAuditStatusHealth(await runPromise(methods.call("runtime/auditStatus", {})))
            );
            await record("agent-orientation:packets", async () =>
              checkAgentOrientationHealth(
                await runPromise(methods.call("agent/workbench", { limit: 3 })),
                await runPromise(methods.call("agent/orient", { panelId: projectedPanels[0]?.id }))
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
