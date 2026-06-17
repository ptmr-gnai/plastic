export const runtimeCapabilitySchema = {
  type: "object",
  required: ["id", "title", "status"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: ["available", "degraded", "unavailable"] },
    notes: { type: "string" }
  }
};

export const runtimeCapabilitiesOutputSchema = {
  type: "object",
  required: ["count", "items"],
  properties: {
    count: { type: "number" },
    items: {
      type: "array",
      items: runtimeCapabilitySchema
    }
  }
};
