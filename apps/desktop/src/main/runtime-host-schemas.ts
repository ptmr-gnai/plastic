import { agentTransportSchema } from "./runtime-control-schemas.js";
import { runtimeHostControlPlaneSchema } from "./runtime-host-control-plane-schema.js";

export const runtimeHostOutputSchema = {
  type: "object",
  required: [
    "service",
    "mode",
    "status",
    "workspaceDir",
    "plasticDir",
    "dataDir",
    "eventPath",
    "runtimeRpcUrl",
    "controlPlane",
    "agentTransports",
    "hostBase",
    "pid",
    "startedAt",
    "capabilities",
    "diagnostics"
  ],
  properties: {
    service: { type: "string" },
    mode: { type: "string", enum: ["electron", "headless"] },
    status: { type: "string", enum: ["running"] },
    workspaceDir: { type: "string" },
    plasticDir: { type: "string" },
    dataDir: { type: "string" },
    eventPath: { type: "string" },
    runtimeRpcUrl: { type: "string" },
    controlPlane: runtimeHostControlPlaneSchema,
    agentTransports: { type: "array", items: agentTransportSchema },
    hostBase: {
      type: "object",
      required: ["id", "version"],
      properties: {
        id: { type: "string", enum: ["runtime-host-base"] },
        version: { type: "number" }
      }
    },
    pid: { type: "number" },
    startedAt: { type: "string" },
    capabilities: {
      type: "object",
      required: ["count", "items"],
      properties: {
        count: { type: "number" },
        items: { type: "array", items: { type: "object" } }
      }
    },
    diagnostics: { type: "object" }
  }
};
