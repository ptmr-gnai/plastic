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

export const eventTimelineItemSchema = {
  type: "object",
  required: ["eventId", "timestamp", "actor", "scope", "type", "summary", "causes", "effects", "links"],
  properties: {
    eventId: { type: "string" },
    timestamp: { type: "string" },
    actor: plasticEventSchema.properties.actor,
    scope: plasticEventSchema.properties.scope,
    type: { type: "string" },
    summary: { type: "string" },
    causes: { type: "array", items: { type: "string" } },
    effects: { type: "array", items: { type: "string" } },
    links: { type: "array", items: { type: "object" } },
    raw: plasticEventSchema
  }
};

export const eventsTimelineOutputSchema = {
  type: "object",
  required: ["latestEventId", "eventCount", "cursor", "items"],
  properties: {
    latestEventId: { type: ["string", "null"] },
    eventCount: { type: "number" },
    cursor: { type: ["string", "null"] },
    items: {
      type: "array",
      items: eventTimelineItemSchema
    }
  }
};

export const plasticMethodSchema = {
  type: "object",
  required: ["id", "title", "owner", "availability", "links"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    owner: {
      type: "object",
      required: ["kind", "id"],
      properties: {
        kind: { type: "string", enum: ["runtime", "extension", "agent", "panel"] },
        id: { type: "string" }
      }
    },
    inputSchema: {},
    outputSchema: {},
    examples: { type: "array", items: { type: "object" } },
    effects: { type: "object" },
    preconditions: { type: "array", items: { type: "string" } },
    reversibility: { type: "object" },
    permissions: { type: "array", items: { type: "string" } },
    availability: {
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["available", "degraded", "unavailable"] },
        requiredCapabilities: { type: "array", items: { type: "string" } },
        missingCapabilities: { type: "array", items: { type: "string" } },
        notes: { type: "string" }
      }
    },
    links: { type: "array", items: { type: "object" } }
  }
};

export const plasticMethodsOutputSchema = {
  type: "array",
  items: plasticMethodSchema
};

export const rpcCallInputSchema = {
  type: "object",
  required: ["method"],
  properties: {
    method: { type: "string", description: "Registered Plastic RPC method id to invoke." },
    input: { description: "Input passed through to the delegated RPC method." }
  }
};
