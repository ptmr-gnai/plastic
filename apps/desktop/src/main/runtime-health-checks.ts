import type { PlasticEvent, PlasticMethod } from "@plastic/core";
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

export const checkMethodAffordanceHealth = (methods: PlasticMethod[]) => {
  const missingDescribeLinks = methods
    .filter((method) =>
      !method.links?.some((link) =>
        link.rel === "describe"
        && link.method === "methods/describe"
        && link.target === method.id
      )
    )
    .map((method) => method.id);
  const missingInvokeLinks = methods
    .filter((method) =>
      !method.links?.some((link) =>
        link.rel === "invoke"
        && link.method === "rpc/call"
        && link.target === method.id
      )
    )
    .map((method) => method.id);
  if (missingDescribeLinks.length > 0) {
    throw new Error(`Methods missing describe links: ${missingDescribeLinks.join(", ")}`);
  }
  if (missingInvokeLinks.length > 0) {
    throw new Error(`Methods missing invoke links: ${missingInvokeLinks.join(", ")}`);
  }
  return {
    count: methods.length,
    missingDescribeLinks,
    missingInvokeLinks
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

export const checkMethodAvailabilityCapabilityHealth = (
  methods: PlasticMethod[],
  capabilities: RuntimeCapability[]
) => {
  const capabilityStatus = new Map(capabilities.map((capability) => [capability.id, capability.status]));
  const staleMissingCapabilities = methods
    .map((method) => {
      const required = method.availability?.requiredCapabilities ?? [];
      const expectedMissing = required
        .filter((capabilityId) => capabilityStatus.get(capabilityId) !== "available")
        .sort();
      const actualMissing = [...(method.availability?.missingCapabilities ?? [])].sort();
      return JSON.stringify(expectedMissing) === JSON.stringify(actualMissing)
        ? null
        : `${method.id}: expected=[${expectedMissing.join(", ")}] actual=[${actualMissing.join(", ")}]`;
    })
    .filter((item): item is string => Boolean(item));
  const availableWithMissingCapabilities = methods
    .filter((method) =>
      method.availability?.status === "available"
      && (method.availability.missingCapabilities?.length ?? 0) > 0
    )
    .map((method) => method.id);
  const unavailableWithoutMissingCapabilities = methods
    .filter((method) =>
      method.availability?.status === "unavailable"
      && (method.availability.requiredCapabilities?.length ?? 0) > 0
      && (method.availability.missingCapabilities?.length ?? 0) === 0
    )
    .map((method) => method.id);
  if (staleMissingCapabilities.length > 0) {
    throw new Error(`Methods with stale missingCapabilities: ${staleMissingCapabilities.join("; ")}`);
  }
  if (availableWithMissingCapabilities.length > 0) {
    throw new Error(`Available methods report missing capabilities: ${availableWithMissingCapabilities.join(", ")}`);
  }
  if (unavailableWithoutMissingCapabilities.length > 0) {
    throw new Error(`Unavailable capability-backed methods do not report missing capabilities: ${unavailableWithoutMissingCapabilities.join(", ")}`);
  }
  return {
    checkedMethods: methods.length,
    staleMissingCapabilities,
    availableWithMissingCapabilities,
    unavailableWithoutMissingCapabilities
  };
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

export const checkRuntimeModuleCoverageHealth = (modules: unknown, methods: PlasticMethod[]) => {
  const items = Array.isArray((modules as { items?: unknown })?.items)
    ? (modules as { items: unknown[] }).items
    : [];
  const registeredMethodIds = methods.map((method) => method.id).sort();
  const moduleMethodIds = items.flatMap((item) =>
    Array.isArray((item as { methodIds?: unknown }).methodIds)
      ? (item as { methodIds: unknown[] }).methodIds.filter((id): id is string => typeof id === "string")
      : []
  );
  const uniqueModuleMethodIds = [...new Set(moduleMethodIds)].sort();
  const duplicateMethodIds = moduleMethodIds
    .filter((id, index) => moduleMethodIds.indexOf(id) !== index)
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort();
  const unassignedMethodIds = registeredMethodIds.filter((id) => !uniqueModuleMethodIds.includes(id));
  const unknownModuleMethodIds = uniqueModuleMethodIds.filter((id) => !registeredMethodIds.includes(id));
  if (unassignedMethodIds.length > 0) {
    throw new Error(`Registered methods missing from runtime module map: ${unassignedMethodIds.join(", ")}`);
  }
  if (unknownModuleMethodIds.length > 0) {
    throw new Error(`Runtime module map references unknown methods: ${unknownModuleMethodIds.join(", ")}`);
  }
  if (duplicateMethodIds.length > 0) {
    throw new Error(`Runtime module map assigns methods more than once: ${duplicateMethodIds.join(", ")}`);
  }
  return {
    registeredMethods: registeredMethodIds.length,
    moduleMethods: uniqueModuleMethodIds.length,
    unassignedMethodIds,
    unknownModuleMethodIds,
    duplicateMethodIds
  };
};

export const checkRuntimeStartedCapabilityParityHealth = (
  capabilities: RuntimeCapability[],
  events: PlasticEvent[]
) => {
  const latestStarted = latestRuntimeStarted(events);
  const durable = capabilitiesFromStarted(latestStarted);
  const livePairs = capabilityPairs(capabilities);
  const durablePairs = capabilityPairs(durable);
  const capabilitiesMatch = stableJson(livePairs) === stableJson(durablePairs);
  if (!latestStarted) {
    throw new Error("runtime.started event is missing");
  }
  if (!capabilitiesMatch) {
    throw new Error("runtime.started capability inventory diverged from live runtime/capabilities");
  }
  return {
    eventId: latestStarted.id,
    liveCapabilities: livePairs.length,
    durableCapabilities: durablePairs.length,
    capabilitiesMatch
  };
};

export const checkRuntimeStartedModuleParityHealth = (
  modules: unknown,
  events: PlasticEvent[]
) => {
  const latestStarted = latestRuntimeStarted(events);
  const live = moduleItems(modules);
  const durable = moduleItems(asRecord(latestStarted?.payload).modules);
  const idsMatch = stableJson(live.map((item) => item.id)) === stableJson(durable.map((item) => item.id));
  const methodsMatch = stableJson(moduleMethodPairs(live)) === stableJson(moduleMethodPairs(durable));
  const availabilityMatch = stableJson(moduleAvailabilityPairs(live)) === stableJson(moduleAvailabilityPairs(durable));
  if (!latestStarted) {
    throw new Error("runtime.started event is missing");
  }
  if (!idsMatch || !methodsMatch || !availabilityMatch) {
    throw new Error("runtime.started module inventory diverged from live runtime/modules");
  }
  return {
    eventId: latestStarted.id,
    liveModules: live.length,
    durableModules: durable.length,
    idsMatch,
    methodsMatch,
    availabilityMatch
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

const latestRuntimeStarted = (events: PlasticEvent[]) =>
  [...events].reverse().find((event) => event.type === "runtime.started");

const capabilitiesFromStarted = (event: PlasticEvent | undefined) => {
  const capabilities = asRecord(event?.payload).capabilities;
  return Array.isArray(capabilities) ? capabilities as RuntimeCapability[] : [];
};

const capabilityPairs = (capabilities: Array<{ id?: unknown; status?: unknown }>) =>
  capabilities
    .map((capability) => [capability.id, capability.status])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));

const moduleItems = (modules: unknown) => {
  if (Array.isArray(modules)) {
    return modules.map(asRecord);
  }
  const items = asRecord(modules).items;
  return Array.isArray(items) ? items.map(asRecord) : [];
};

const moduleMethodPairs = (items: Record<string, unknown>[]) =>
  items
    .map((item) => [item.id, [...(Array.isArray(item.methodIds) ? item.methodIds : [])].sort()])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));

const moduleAvailabilityPairs = (items: Record<string, unknown>[]) =>
  items
    .map((item) => [item.id, item.availability ?? null])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));

const stableJson = (value: unknown) => JSON.stringify(value);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
