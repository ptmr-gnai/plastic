import type { PlasticMethod } from "@plastic/core";
import type { RuntimeCapability } from "./runtime-method-context.js";

export const requiredRuntimeMethods = [
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

export const requiredRuntimeCapabilities = [
  "runtime.capabilities",
  "window.projection",
  "event.projection"
];

export const checkMethodRegistryHealth = (
  methods: PlasticMethod[],
  capabilities: RuntimeCapability[]
) => {
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  const methodIds = new Set(methods.map((method) => method.id));
  const missingAvailability = methods
    .filter((method) => !method.availability?.status)
    .map((method) => method.id);
  const missingReferencedCapabilities = methods.flatMap((method) =>
    (method.availability?.requiredCapabilities ?? [])
      .filter((capabilityId) => !capabilityIds.has(capabilityId))
      .map((capabilityId) => `${method.id}:${capabilityId}`)
  );
  const missingRequiredMethods = requiredRuntimeMethods.filter((id) => !methodIds.has(id));
  if (missingAvailability.length > 0) {
    throw new Error(`Methods missing availability: ${missingAvailability.join(", ")}`);
  }
  if (missingReferencedCapabilities.length > 0) {
    throw new Error(`Methods reference missing capabilities: ${missingReferencedCapabilities.join(", ")}`);
  }
  if (missingRequiredMethods.length > 0) {
    throw new Error(`Required methods missing: ${missingRequiredMethods.join(", ")}`);
  }
  return { count: methods.length, missingAvailability, missingReferencedCapabilities, missingRequiredMethods };
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
