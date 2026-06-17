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

export const plasticEventSchema = {
  type: "object",
  required: ["id", "type", "version", "timestamp", "actor", "scope", "payload", "meta"],
  properties: {
    id: { type: "string" },
    type: { type: "string" },
    version: { type: "number" },
    timestamp: { type: "string" },
    actor: {
      type: "object",
      required: ["kind", "id"],
      properties: {
        kind: { type: "string", enum: ["user", "agent", "extension", "system", "cron"] },
        id: { type: "string" },
        name: { type: "string" }
      }
    },
    scope: {
      type: "object",
      required: ["workspaceId"],
      properties: {
        workspaceId: { type: "string" },
        windowId: { type: "string" },
        panelId: { type: "string" },
        extensionId: { type: "string" },
        agentId: { type: "string" },
        projectDir: { type: "string" }
      }
    },
    correlationId: { type: "string" },
    causationId: { type: "string" },
    payload: {},
    meta: { type: "object" }
  }
};

export const eventsListOutputSchema = {
  type: "array",
  items: plasticEventSchema
};
