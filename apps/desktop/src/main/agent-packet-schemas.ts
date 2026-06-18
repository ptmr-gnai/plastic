import { eventTimelineItemSchema, plasticMethodSchema, runtimeCapabilitySchema, agentTransportSchema } from "./runtime-control-schemas.js";
import { runtimeHostControlPlaneSchema } from "./runtime-host-control-plane-schema.js";
import { runtimeModulesOutputSchema } from "./runtime-module-schemas.js";
import { plasticStateResourceLinkSchema } from "./runtime-state-schemas.js";

const actionAffordanceSchema = {
  type: "object",
  required: ["id", "title", "method", "intent", "risk"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    method: { type: "string" },
    intent: { type: "string", enum: ["read", "inspect", "execute"] },
    risk: { type: "string", enum: ["none", "low", "medium"] },
    input: { type: "object" }
  }
};

const flatVisibleRefSchema = {
  type: "object",
  required: ["windowId"],
  properties: {
    windowId: { type: "number" },
    ref: { type: "string" },
    panel: { type: "string" },
    extension: { type: "string" },
    command: { type: "string" },
    tag: { type: "string" },
    text: { type: "string" },
    bounds: { type: "object" }
  }
};

const agentMethodSummarySchema = {
  type: "object",
  required: ["id", "title", "owner"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    owner: plasticMethodSchema.properties.owner
  }
};

const methodGroupSchema = {
  type: "object",
  required: ["owner", "count", "methods"],
  properties: {
    owner: { type: "string" },
    count: { type: "number" },
    methods: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" }
        }
      }
    }
  }
};

const methodParitySchema = {
  type: "object",
  required: ["reportPath", "mode", "failureTotal"],
  properties: {
    reportPath: { type: ["string", "null"] },
    mode: { type: "string" },
    failureTotal: { type: ["number", "null"] }
  }
};

const auditMetadataSchema = {
  type: "object",
  required: ["schemaVersion", "generatedAt", "inProgress", "checks", "expectedChecks", "expectedStepIds", "usable", "strictElectron", "unified", "methodParity"],
  properties: {
    schemaVersion: { type: ["number", "null"] },
    generatedAt: { type: ["string", "null"] },
    inProgress: { type: "boolean" },
    checks: { type: ["number", "null"] },
    expectedChecks: { type: ["number", "null"] },
    expectedStepIds: { type: "array", items: { type: "string" } },
    usable: { type: "boolean" },
    strictElectron: { type: "string" },
    unified: { type: "string" },
    methodParity: methodParitySchema
  }
};

const recentAuditActionSchema = {
  type: "object",
  required: ["actionId", "ok", "exitCode", "auditMetadata", "env"],
  properties: {
    actionId: { type: ["string", "null"] },
    ok: { type: "boolean" },
    exitCode: { type: ["number", "null"] },
    auditMetadata: { anyOf: [{ type: "null" }, auditMetadataSchema] },
    env: { type: "object" }
  }
};

const failureSummarySchema = {
  type: "object",
  required: ["count", "ids", "blockingIds", "first"],
  properties: {
    count: { type: "number" },
    ids: { type: "array", items: { type: "string" } },
    blockingIds: { type: "array", items: { type: "string" } },
    first: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          required: ["id", "command", "exit"],
          properties: {
            id: { type: "string" },
            command: { type: ["string", "null"] },
            exit: { type: ["number", "string", "null"] }
          }
        }
      ]
    }
  }
};

const diagnosisSchema = {
  type: "object",
  required: ["code", "phase"],
  properties: {
    code: { type: "string" },
    phase: { type: ["string", "null"] }
  }
};

const auditStatusSchema = {
  type: "object",
  required: ["available", "verdict", "audit", "diagnosis", "failureSummary", "nextAction", "actionIds", "recentActions"],
  properties: {
    available: { type: "boolean" },
    verdict: { type: "string" },
    audit: auditMetadataSchema,
    diagnosis: diagnosisSchema,
    failureSummary: failureSummarySchema,
    nextAction: { type: ["string", "null"] },
    actionIds: { type: "array", items: { type: "string" } },
    recentActions: { type: "array", items: recentAuditActionSchema }
  }
};

const capabilityPacketSchema = {
  type: "object",
  required: ["count", "items", "statuses"],
  properties: {
    count: { type: "number" },
    items: { type: "array", items: runtimeCapabilitySchema },
    statuses: { type: "object" }
  }
};

export const agentWorkbenchOutputSchema = {
  type: "object",
  required: ["app", "focus", "observability", "control", "workspace", "obligations"],
  properties: {
    app: { type: "object" },
    focus: { type: "object" },
    observability: {
      type: "object",
      required: ["visibleRefs", "sourceHints", "timeline", "latestEventId"],
      properties: {
        visibleRefs: { type: "array", items: flatVisibleRefSchema },
        sourceHints: { type: "array", items: { type: "string" } },
        timeline: {
          type: "object",
          required: ["latestEventId", "eventCount", "cursor", "items"],
          properties: {
            latestEventId: { type: ["string", "null"] },
            eventCount: { type: "number" },
            cursor: { type: ["string", "null"] },
            items: { type: "array", items: eventTimelineItemSchema }
          }
        },
        latestEventId: { type: ["string", "null"] }
      }
    },
    control: {
      type: "object",
      required: ["capabilities", "controlPlane", "agentTransports", "auditStatus", "modules", "methodCount", "methodGroups", "links", "recommendedActions"],
      properties: {
        capabilities: capabilityPacketSchema,
        controlPlane: runtimeHostControlPlaneSchema,
        agentTransports: { type: "array", items: agentTransportSchema },
        auditStatus: auditStatusSchema,
        modules: runtimeModulesOutputSchema,
        methodCount: { type: "number" },
        methodGroups: { type: "array", items: methodGroupSchema },
        links: { type: "array", items: plasticStateResourceLinkSchema },
        recommendedActions: { type: "array", items: actionAffordanceSchema }
      }
    },
    workspace: { type: "object" },
    obligations: { type: "object" }
  }
};

export const agentOrientOutputSchema = {
  type: "object",
  required: ["agent", "embodiment", "visibleContext", "memory", "capabilities", "obligations"],
  properties: {
    agent: {
      type: "object",
      required: ["id", "name", "runtime", "role"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        runtime: { type: "string" },
        role: { type: "string" }
      }
    },
    embodiment: { type: "object" },
    visibleContext: { type: "object" },
    memory: {
      type: "object",
      required: ["latestEventId", "eventCount", "eventCursor", "sinceCursor", "recentUserIntents", "recentAgentActions"],
      properties: {
        latestEventId: { type: ["string", "null"] },
        eventCount: { type: "number" },
        eventCursor: { type: ["string", "null"] },
        sinceCursor: { type: "array", items: eventTimelineItemSchema },
        recentUserIntents: { type: "array", items: eventTimelineItemSchema },
        recentAgentActions: { type: "array", items: eventTimelineItemSchema }
      }
    },
    capabilities: {
      type: "object",
      required: ["hostBase", "host", "modules", "auditStatus", "controlPlane", "agentTransports", "methodCount", "methods", "recommendedActions", "links"],
      properties: {
        hostBase: { type: "object" },
        host: capabilityPacketSchema,
        modules: runtimeModulesOutputSchema,
        auditStatus: auditStatusSchema,
        controlPlane: runtimeHostControlPlaneSchema,
        agentTransports: { type: "array", items: agentTransportSchema },
        methodCount: { type: "number" },
        methods: { type: "array", items: agentMethodSummarySchema },
        recommendedActions: { type: "array", items: actionAffordanceSchema },
        links: { type: "array", items: plasticStateResourceLinkSchema }
      }
    },
    obligations: { type: "object" }
  }
};
