const runtimeModuleAvailabilitySchema = {
  type: "object",
  required: ["available", "degraded", "unavailable", "requiredCapabilities", "missingCapabilities"],
  properties: {
    available: { type: "number" },
    degraded: { type: "number" },
    unavailable: { type: "number" },
    requiredCapabilities: { type: "array", items: { type: "string" } },
    missingCapabilities: { type: "array", items: { type: "string" } }
  }
};

export const runtimeModulesOutputSchema = {
  type: "object",
  required: ["count", "items"],
  properties: {
    count: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "order", "methodIds", "availability"],
        properties: {
          id: { type: "string" },
          order: { type: "number" },
          methodIds: { type: "array", items: { type: "string" } },
          availability: runtimeModuleAvailabilitySchema
        }
      }
    }
  }
};
