import type { PlasticMethod } from "@plastic/core";
import type { RuntimeCapability } from "./runtime-method-context.js";

export const requiredRuntimeMethods = [
  "plastic/state",
  "plastic/methods",
  "methods/describe",
  "rpc/call",
  "runtime/capabilities",
  "runtime/host",
  "runtime/modules",
  "runtime/auditStatus",
  "runtime/auditActionPlan",
  "runtime/runAuditAction",
  "panels/create",
  "events/list",
  "events/timeline",
  "plastic/selfTest"
];

const requiredRuntimeModules = [
  "runtime-state",
  "runtime-snapshot",
  "agent-workbench",
  "agent-orient",
  "runtime-build",
  "runtime-diagnostics",
  "extension-authoring",
  "renderer-control",
  "runtime-control",
  "panel-control",
  "window-capability",
  "deixis",
  "runtime-health",
  "extension-runtime",
  "panel-mailbox",
  "runtime-host",
  "runtime-modules"
];

export const requiredRuntimeCapabilities = [
  "runtime.capabilities",
  "window.projection",
  "event.projection",
  "electron.window",
  "dom.refs",
  "dom.eval",
  "dom.input",
  "screenshot",
  "agent.codex"
];

export const checkMethodRegistryHealth = (
  methods: PlasticMethod[],
  capabilities: RuntimeCapability[]
) => {
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  const methodIds = new Set(methods.map((method) => method.id));
  const invalidIdentity = methods
    .filter((method) =>
      !method.id
      || !method.title
      || !method.owner?.kind
      || !method.owner?.id
    )
    .map((method) => method.id || "<missing-id>");
  const missingAvailability = methods
    .filter((method) => !method.availability?.status)
    .map((method) => method.id);
  const invalidAvailabilityStatuses = methods
    .filter((method) =>
      method.availability?.status
      && !["available", "degraded", "unavailable"].includes(method.availability.status)
    )
    .map((method) => method.id);
  const missingReferencedCapabilities = methods.flatMap((method) =>
    (method.availability?.requiredCapabilities ?? [])
      .filter((capabilityId) => !capabilityIds.has(capabilityId))
      .map((capabilityId) => `${method.id}:${capabilityId}`)
  );
  const missingRequiredMethods = requiredRuntimeMethods.filter((id) => !methodIds.has(id));
  if (invalidIdentity.length > 0) {
    throw new Error(`Methods with invalid identity metadata: ${invalidIdentity.join(", ")}`);
  }
  if (missingAvailability.length > 0) {
    throw new Error(`Methods missing availability: ${missingAvailability.join(", ")}`);
  }
  if (invalidAvailabilityStatuses.length > 0) {
    throw new Error(`Methods with invalid availability status: ${invalidAvailabilityStatuses.join(", ")}`);
  }
  if (missingReferencedCapabilities.length > 0) {
    throw new Error(`Methods reference missing capabilities: ${missingReferencedCapabilities.join(", ")}`);
  }
  if (missingRequiredMethods.length > 0) {
    throw new Error(`Required methods missing: ${missingRequiredMethods.join(", ")}`);
  }
  return {
    count: methods.length,
    invalidIdentity,
    missingAvailability,
    invalidAvailabilityStatuses,
    missingReferencedCapabilities,
    missingRequiredMethods,
    requiredDiagnosticsMethods: methodIds.has("runtime/auditStatus") && methodIds.has("runtime/auditActionPlan") && methodIds.has("runtime/runAuditAction")
  };
};

export const checkCapabilityRegistryHealth = (capabilities: RuntimeCapability[]) => {
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  const invalidStatuses = capabilities
    .filter((capability) => !["available", "degraded", "unavailable"].includes(capability.status))
    .map((capability) => capability.id);
  const missingRequiredCapabilities = requiredRuntimeCapabilities.filter((id) => !capabilityIds.has(id));
  if (invalidStatuses.length > 0) {
    throw new Error(`Capabilities with invalid status: ${invalidStatuses.join(", ")}`);
  }
  if (missingRequiredCapabilities.length > 0) {
    throw new Error(`Required capabilities missing: ${missingRequiredCapabilities.join(", ")}`);
  }
  return { count: capabilities.length, invalidStatuses, missingRequiredCapabilities };
};

export const checkRuntimeModuleMapHealth = (modules: unknown) => {
  const items = Array.isArray((modules as { items?: unknown })?.items)
    ? (modules as { items: unknown[] }).items
    : [];
  const ids = new Set(items.map((item) => (item as { id?: string }).id).filter(Boolean));
  const missingRequiredModules = requiredRuntimeModules.filter((id) => !ids.has(id));
  const missingAgentBackend = !ids.has("agent-backend");
  const missingMethodIds = items
    .filter((item) => !Array.isArray((item as { methodIds?: unknown }).methodIds))
    .map((item) => (item as { id?: string }).id ?? "<missing-id>");
  const missingAvailabilitySummary = items
    .filter((item) => !hasModuleAvailabilitySummary(item))
    .map((item) => (item as { id?: string }).id ?? "<missing-id>");
  const invalidAvailabilityCounts = items
    .filter((item) => hasModuleAvailabilitySummary(item))
    .filter((item) => !moduleAvailabilityCountsMatch(item))
    .map((item) => (item as { id?: string }).id ?? "<missing-id>");
  const missingContributions = [
    moduleMethodMissing(items, "runtime-control", "plastic/methods"),
    moduleMethodMissing(items, "panel-control", "panels/create"),
    moduleMethodMissing(items, "runtime-host", "runtime/host"),
    moduleMethodMissing(items, "runtime-modules", "runtime/modules")
  ].filter((item): item is string => Boolean(item));
  if (missingRequiredModules.length > 0) {
    throw new Error(`Required runtime modules missing: ${missingRequiredModules.join(", ")}`);
  }
  if (missingAgentBackend) {
    throw new Error("Runtime module map missing agent backend module");
  }
  if (missingMethodIds.length > 0) {
    throw new Error(`Runtime modules missing methodIds: ${missingMethodIds.join(", ")}`);
  }
  if (missingAvailabilitySummary.length > 0) {
    throw new Error(`Runtime modules missing availability summaries: ${missingAvailabilitySummary.join(", ")}`);
  }
  if (invalidAvailabilityCounts.length > 0) {
    throw new Error(`Runtime module availability counts mismatch: ${invalidAvailabilityCounts.join(", ")}`);
  }
  if (missingContributions.length > 0) {
    throw new Error(`Runtime module method contributions missing: ${missingContributions.join(", ")}`);
  }
  return {
    count: items.length,
    missingRequiredModules,
    missingAgentBackend,
    requiredHostModule: ids.has("runtime-host"),
    missingMethodIds,
    missingAvailabilitySummary,
    invalidAvailabilityCounts,
    missingContributions
  };
};

const hasModuleAvailabilitySummary = (item: unknown) => {
  const availability = (item as { availability?: Record<string, unknown> }).availability;
  return typeof availability?.available === "number"
    && typeof availability.degraded === "number"
    && typeof availability.unavailable === "number"
    && Array.isArray(availability.requiredCapabilities)
    && Array.isArray(availability.missingCapabilities);
};

const moduleAvailabilityCountsMatch = (item: unknown) => {
  const module = item as {
    methodIds?: unknown[];
    availability?: { available: number; degraded: number; unavailable: number };
  };
  return module.availability !== undefined
    && module.availability.available + module.availability.degraded + module.availability.unavailable
      === (module.methodIds?.length ?? 0);
};

const moduleMethodMissing = (items: unknown[], moduleId: string, methodId: string) => {
  const module = items.find((item) => (item as { id?: string }).id === moduleId) as { methodIds?: unknown } | undefined;
  return Array.isArray(module?.methodIds) && module.methodIds.includes(methodId)
    ? null
    : `${moduleId}:${methodId}`;
};
