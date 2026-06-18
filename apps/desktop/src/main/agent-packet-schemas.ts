import { agentTransportSchema } from "./runtime-control-schemas.js";

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

const controlPlaneSchema = {
  type: "object",
  required: ["runtime", "build"],
  properties: {
    runtime: { type: "object" },
    build: { type: "object" }
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

const auditStatusSchema = {
  type: "object",
  required: ["verdict", "audit", "failureSummary", "actionIds", "recentActions"],
  properties: {
    verdict: { type: "string" },
    audit: auditMetadataSchema,
    failureSummary: { type: "object" },
    actionIds: { type: "array", items: { type: "string" } },
    recentActions: { type: "array", items: recentAuditActionSchema }
  }
};

const capabilityPacketSchema = {
  type: "object",
  required: ["count", "items", "statuses"],
  properties: {
    count: { type: "number" },
    items: { type: "array", items: { type: "object" } },
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
        visibleRefs: { type: "array", items: { type: "object" } },
        sourceHints: { type: "array", items: { type: "string" } },
        timeline: { type: "object" },
        latestEventId: { type: ["string", "null"] }
      }
    },
    control: {
      type: "object",
      required: ["capabilities", "controlPlane", "agentTransports", "auditStatus", "modules", "methodCount", "methodGroups", "links", "recommendedActions"],
      properties: {
        capabilities: capabilityPacketSchema,
        controlPlane: controlPlaneSchema,
        agentTransports: { type: "array", items: agentTransportSchema },
        auditStatus: auditStatusSchema,
        modules: { type: "object" },
        methodCount: { type: "number" },
        methodGroups: { type: "array", items: { type: "object" } },
        links: { type: "array", items: { type: "object" } },
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
        sinceCursor: { type: "array", items: { type: "object" } },
        recentUserIntents: { type: "array", items: { type: "object" } },
        recentAgentActions: { type: "array", items: { type: "object" } }
      }
    },
    capabilities: {
      type: "object",
      required: ["hostBase", "host", "modules", "auditStatus", "controlPlane", "agentTransports", "methodCount", "methods", "recommendedActions", "links"],
      properties: {
        hostBase: { type: "object" },
        host: capabilityPacketSchema,
        modules: { type: "object" },
        auditStatus: auditStatusSchema,
        controlPlane: controlPlaneSchema,
        agentTransports: { type: "array", items: agentTransportSchema },
        methodCount: { type: "number" },
        methods: { type: "array", items: { type: "object" } },
        recommendedActions: { type: "array", items: actionAffordanceSchema },
        links: { type: "array", items: { type: "object" } }
      }
    },
    obligations: { type: "object" }
  }
};
