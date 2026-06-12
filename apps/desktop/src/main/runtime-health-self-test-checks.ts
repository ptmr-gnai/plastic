import type { PlasticEvent, PlasticExtension, PlasticPanel, PlasticWindow } from "@plastic/core";
import {
  expectedOrientationActions,
  expectedOrientationLinks,
  expectedSnapshotLinks,
  expectedWorkbenchActions,
  hasActionAffordance,
  hasLinkAffordance,
  hasServiceAffordance
} from "./runtime-health-affordance-checks.js";
import { invalidControlPlaneUrls } from "./runtime-health-control-plane-checks.js";
import type { RuntimeCapability } from "./runtime-method-context.js";

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

export const checkBuildStatusHealth = (buildStatus: unknown) => {
  const status = asRecord(buildStatus);
  const hostBase = asRecord(status.hostBase);
  const controlPlane = asRecord(status.controlPlane);
  const runtimeControlPlane = asRecord(controlPlane.runtime);
  const buildControlPlane = asRecord(controlPlane.build);
  const transports = Array.isArray(status.agentTransports) ? status.agentTransports.map(asRecord) : [];
  const invalidTransportAffordances = invalidAgentTransportAffordances(transports);
  const invalidControlPlaneEndpointUrls = invalidControlPlaneUrls(controlPlane);
  if (status.status !== "running") {
    throw new Error("build/status did not report running");
  }
  if (hostBase.id !== "runtime-host-base" || hostBase.version !== 1) {
    throw new Error("build/status missing shared host base marker");
  }
  if (runtimeControlPlane.transport !== "http" || buildControlPlane.transport !== "http") {
    throw new Error("build/status missing runtime/build HTTP control plane");
  }
  if (invalidControlPlaneEndpointUrls.length > 0) {
    throw new Error(`build/status control plane URLs are invalid: ${invalidControlPlaneEndpointUrls.join(", ")}`);
  }
  if (typeof status.workspaceDir !== "string" || typeof status.eventPath !== "string") {
    throw new Error("build/status missing workspace paths");
  }
  if (!transports.some((transport) => transport.id === "http-rpc") || !transports.some((transport) => transport.id === "mcp-stdio")) {
    throw new Error("build/status missing agent transport affordances");
  }
  if (invalidTransportAffordances.length > 0) {
    throw new Error(`build/status agent transports have invalid affordances: ${invalidTransportAffordances.join(", ")}`);
  }
  return {
    service: status.service ?? null,
    mode: status.mode ?? null,
    runtimeTransport: runtimeControlPlane.transport,
    buildTransport: buildControlPlane.transport,
    agentTransports: transports.length,
    invalidControlPlaneEndpointUrls,
    invalidTransportAffordances
  };
};

export const checkRuntimeAuditStatusHealth = (auditStatus: unknown) => {
  const verdict = (auditStatus as { verdict?: Record<string, unknown> })?.verdict;
  const status = verdict?.status;
  const actions = Array.isArray(verdict?.actions) ? verdict.actions.map(asRecord) : [];
  const diagnosis = asRecord(verdict?.diagnosis);
  const failureSummary = asRecord(verdict?.failureSummary);
  const firstFailure = failureSummary.first === null ? null : asRecord(failureSummary.first);
  const invalidActionInvocations = actions
    .filter((action) =>
      action.method !== "runtime/runAuditAction"
      || asRecord(action.input).id !== action.id
      || typeof asRecord(action.run).command !== "string"
      || !Array.isArray(asRecord(action.run).args)
    )
    .map((action) => String(action.id ?? "<missing-id>"));
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
  if (!Array.isArray(verdict?.actions)) {
    throw new Error("runtime/auditStatus verdict actions are missing");
  }
  if (invalidActionInvocations.length > 0) {
    throw new Error(`runtime/auditStatus actions have invalid invocation metadata: ${invalidActionInvocations.join(", ")}`);
  }
  return {
    available: (auditStatus as { available?: unknown }).available === true,
    status,
    diagnosisCode: diagnosis.code,
    failureCount: failureSummary.count,
    failureIds: failureSummary.ids.filter((id): id is string => typeof id === "string"),
    blockingFailureIds: failureSummary.blockingIds.filter((id): id is string => typeof id === "string"),
    firstFailureId: firstFailure?.id ?? null,
    actions: actions.length,
    invalidActionInvocations
  };
};

export const checkAgentTransportsHealth = (events: PlasticEvent[]) => {
  const latestStarted = [...events].reverse().find((event) => event.type === "runtime.started");
  const host = asRecord(asRecord(latestStarted?.payload).host);
  const transports = Array.isArray(host.agentTransports) ? host.agentTransports.map(asRecord) : [];
  const http = transports.find((transport) => transport.id === "http-rpc");
  const mcp = transports.find((transport) => transport.id === "mcp-stdio");
  const invalidTransportAffordances = invalidAgentTransportAffordances(transports);
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
  if (invalidTransportAffordances.length > 0) {
    throw new Error(`Agent transports have invalid affordances: ${invalidTransportAffordances.join(", ")}`);
  }
  return {
    count: transports.length,
    ids: transports.map((transport) => transport.id),
    mcpTool: "plastic_rpc",
    invalidTransportAffordances
  };
};

export const checkCapabilityProjectionHealth = (
  capabilities: RuntimeCapability[],
  runtimeCapabilities: unknown,
  events: PlasticEvent[]
) => {
  const liveItems = normalizeCapabilities(capabilities);
  const projection = asRecord(runtimeCapabilities);
  const projectionItems = normalizeCapabilities(Array.isArray(projection.items) ? projection.items : []);
  const latestStarted = [...events].reverse().find((event) => event.type === "runtime.started");
  const durableItems = normalizeCapabilities(
    Array.isArray(asRecord(latestStarted?.payload).capabilities)
      ? asRecord(latestStarted?.payload).capabilities as unknown[]
      : []
  );
  if (projection.count !== liveItems.length) {
    throw new Error("runtime/capabilities count does not match live capability registry");
  }
  if (JSON.stringify(projectionItems) !== JSON.stringify(liveItems)) {
    throw new Error("runtime/capabilities items do not match live capability registry");
  }
  if (JSON.stringify(durableItems) !== JSON.stringify(liveItems)) {
    throw new Error("runtime.started capability inventory does not match live capability registry");
  }
  return {
    count: liveItems.length,
    ids: liveItems.map((capability) => capability.id),
    durableEventId: latestStarted?.id ?? null
  };
};

export const checkProjectionDiscoveryHealth = (
  state: unknown,
  snapshot: unknown,
  methodList: Array<{ id: string; availability?: { status?: string } }>
) => {
  const stateRecord = asRecord(state);
  const snapshotRecord = asRecord(snapshot);
  const stateControlPlane = asRecord(stateRecord.controlPlane);
  const snapshotControlPlane = asRecord(snapshotRecord.controlPlane);
  const stateResources = Array.isArray(stateRecord.resources) ? stateRecord.resources.map(asRecord) : [];
  const serviceResources = stateResources.filter((resource) => resource.kind === "service");
  const snapshotLinks = Array.isArray(snapshotRecord.links) ? snapshotRecord.links.map(asRecord) : [];
  const snapshotMethods = asRecord(snapshotRecord.methods);
  const snapshotMethodItems = Array.isArray(snapshotMethods.items) ? snapshotMethods.items.map(asRecord) : [];
  const invalidStateControlPlaneUrls = invalidControlPlaneUrls(stateControlPlane);
  const invalidSnapshotControlPlaneUrls = invalidControlPlaneUrls(snapshotControlPlane);
  if (asRecord(stateControlPlane.runtime).transport !== "http" || asRecord(snapshotControlPlane.runtime).transport !== "http") {
    throw new Error("state/snapshot projections must expose the shared runtime HTTP control plane");
  }
  if (invalidStateControlPlaneUrls.length > 0) {
    throw new Error(`plastic/state control plane URLs are invalid: ${invalidStateControlPlaneUrls.join(", ")}`);
  }
  if (invalidSnapshotControlPlaneUrls.length > 0) {
    throw new Error(`plastic/snapshot control plane URLs are invalid: ${invalidSnapshotControlPlaneUrls.join(", ")}`);
  }
  if (!serviceResources.some((resource) => hasServiceAffordance(resource, {
    rel: "host",
    href: "runtime/host",
    method: "runtime/host",
    actionId: "read-host"
  }))) {
    throw new Error("plastic/state service resource missing runtime/host affordances");
  }
  if (!serviceResources.some((resource) => hasServiceAffordance(resource, {
    rel: "capabilities",
    href: "runtime/capabilities",
    method: "runtime/capabilities",
    actionId: "read-capabilities"
  }))) {
    throw new Error("plastic/state service resource missing runtime/capabilities affordances");
  }
  if (!serviceResources.some((resource) => hasServiceAffordance(resource, {
    rel: "self-test",
    href: "plastic/selfTest",
    method: "plastic/selfTest",
    actionId: "run-self-test"
  }))) {
    throw new Error("plastic/state service resource missing plastic/selfTest affordances");
  }
  for (const link of expectedSnapshotLinks) {
    if (!hasLinkAffordance(snapshotLinks, link)) {
      throw new Error(`plastic/snapshot missing ${link.method} link`);
    }
  }
  if (snapshotMethods.count !== methodList.length || snapshotMethodItems.length !== methodList.length) {
    throw new Error("plastic/snapshot method catalog count does not match plastic/methods");
  }
  if (!snapshotMethodItems.every((method) => typeof asRecord(method.availability).status === "string")) {
    throw new Error("plastic/snapshot method catalog is missing availability metadata");
  }
  return {
    serviceResources: serviceResources.length,
    snapshotLinks: snapshotLinks.length,
    methods: snapshotMethodItems.length,
    invalidStateControlPlaneUrls,
    invalidSnapshotControlPlaneUrls
  };
};

export const checkRuntimeStartedDescriptorHealth = (events: PlasticEvent[]) => {
  const latestStarted = [...events].reverse().find((event) => event.type === "runtime.started");
  const payload = asRecord(latestStarted?.payload);
  const host = asRecord(payload.host);
  const controlPlane = asRecord(payload.controlPlane);
  const runtimeControlPlane = asRecord(controlPlane.runtime);
  const buildControlPlane = asRecord(controlPlane.build);
  const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities.map(asRecord) : [];
  const modules = Array.isArray(payload.modules) ? payload.modules.map(asRecord) : [];
  const invalidStartedControlPlaneUrls = invalidControlPlaneUrls(controlPlane);
  if (!latestStarted) {
    throw new Error("runtime.started event is missing");
  }
  if (host.hostBase === undefined || !Array.isArray(host.agentTransports)) {
    throw new Error("runtime.started host descriptor is incomplete");
  }
  if (runtimeControlPlane.transport !== "http" || buildControlPlane.transport !== "http") {
    throw new Error("runtime.started control plane must expose runtime and build HTTP transports");
  }
  if (invalidStartedControlPlaneUrls.length > 0) {
    throw new Error(`runtime.started control plane URLs are invalid: ${invalidStartedControlPlaneUrls.join(", ")}`);
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
    invalidStartedControlPlaneUrls,
    capabilities: capabilities.length,
    modules: modules.length,
    agentTransports: host.agentTransports.length
  };
};

export const checkExtensionRuntimeHealth = (extensions: PlasticExtension[], methodIds: Set<string>) => {
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

export const checkPanelRuntimeHealth = (panels: PlasticPanel[], extensions: PlasticExtension[], methodIds: Set<string>) => {
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

export const checkWindowRuntimeHealth = (windows: PlasticWindow[], panels: PlasticPanel[], methodList: Array<{ id: string; availability?: { status?: string; missingCapabilities?: string[] } }>) => {
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

export const checkAgentOrientationHealth = (workbench: unknown, orientation: unknown, methodIds: Set<string>) => {
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
  const missingWorkbenchActions = expectedWorkbenchActions.filter((action) => !hasActionAffordance(workbenchActions, action));
  const missingOrientationActions = expectedOrientationActions.filter((action) => !hasActionAffordance(orientationActions, action));
  const missingOrientationLinks = expectedOrientationLinks.filter((link) => !hasLinkAffordance(orientationLinks, link));
  const unknownWorkbenchActions = unknownMethodReferences(workbenchActions, methodIds);
  const unknownOrientationActions = unknownMethodReferences(orientationActions, methodIds);
  const unknownOrientationLinks = unknownMethodReferences(orientationLinks, methodIds);
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
    throw new Error(`agent/workbench missing actions: ${missingWorkbenchActions.map((action) => action.id).join(", ")}`);
  }
  if (missingOrientationActions.length > 0) {
    throw new Error(`agent/orient missing actions: ${missingOrientationActions.map((action) => action.id).join(", ")}`);
  }
  if (missingOrientationLinks.length > 0) {
    throw new Error(`agent/orient missing links: ${missingOrientationLinks.map((link) => link.rel).join(", ")}`);
  }
  if (unknownWorkbenchActions.length > 0 || unknownOrientationActions.length > 0 || unknownOrientationLinks.length > 0) {
    throw new Error("agent orientation packet references unknown methods");
  }
  return {
    workbenchActions: workbenchActions.length,
    orientationActions: orientationActions.length,
    orientationLinks: orientationLinks.length,
    unknownWorkbenchActions,
    unknownOrientationActions,
    unknownOrientationLinks,
    agentTransports: agentTransports.length,
    auditVerdict: auditStatus.verdict,
    auditFailureCount: failureSummary.count
  };
};

const unknownMethodReferences = (references: Record<string, unknown>[], methodIds: Set<string>) =>
  references
    .map((reference) => reference.method)
    .filter((method): method is string => typeof method === "string" && !methodIds.has(method));

const invalidAgentTransportAffordances = (transports: Record<string, unknown>[]) => {
  const http = transports.find((transport) => transport.id === "http-rpc");
  const mcp = transports.find((transport) => transport.id === "mcp-stdio");
  const methodsUrl = typeof http?.rpcUrl === "string" ? http.rpcUrl.replace(/\/rpc$/, "/methods") : undefined;
  const selfTestUrl = typeof http?.rpcUrl === "string" ? http.rpcUrl.replace(/\/rpc$/, "/self-test") : undefined;
  return [
    !Array.isArray(http?.links) || !http.links.some((link) => {
      const record = asRecord(link);
      return record.rel === "methods" && record.method === "http/get" && record.href === methodsUrl;
    })
      ? "http-rpc:methods-link"
      : null,
    !Array.isArray(http?.links) || !http.links.some((link) => {
      const record = asRecord(link);
      return record.rel === "self-test" && record.method === "http/get" && record.href === selfTestUrl;
    })
      ? "http-rpc:self-test-link"
      : null,
    !Array.isArray(http?.actions) || !http.actions.some((action) => {
      const record = asRecord(action);
      return record.id === "call-plastic-rpc" && record.method === "http/post" && record.href === http?.rpcUrl;
    })
      ? "http-rpc:call-action"
      : null,
    !Array.isArray(mcp?.tools) || !mcp.tools.some((tool) => asRecord(tool).name === "plastic_rpc" && asRecord(tool).methodRegistry === "shared")
      ? "mcp-stdio:plastic-rpc-tool"
      : null,
    !Array.isArray(mcp?.actions) || !mcp.actions.some((action) => {
      const record = asRecord(action);
      return record.id === "call-plastic-rpc" && record.tool === "plastic_rpc" && asRecord(asRecord(action).arguments).method === "agent/orient";
    })
      ? "mcp-stdio:call-action"
      : null
  ].filter((item): item is string => Boolean(item));
};

const normalizeCapabilities = (capabilities: unknown[]) =>
  capabilities
    .map((capability) => {
      const record = asRecord(capability);
      return {
        id: record.id,
        title: record.title,
        status: record.status,
        notes: record.notes
      };
    })
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
