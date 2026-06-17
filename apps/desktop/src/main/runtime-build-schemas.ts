export const buildStatusOutputSchema = {
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
    "buildSocket",
    "hostBase",
    "pid",
    "startedAt"
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
    controlPlane: {
      type: "object",
      required: ["runtime", "build"],
      properties: {
        runtime: { type: "object" },
        build: { type: "object" }
      }
    },
    agentTransports: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status", "methodRegistry"],
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          methodRegistry: { type: "string", enum: ["shared"] }
        }
      }
    },
    buildSocket: { type: "string" },
    hostBase: {
      type: "object",
      required: ["id", "version"],
      properties: {
        id: { type: "string", enum: ["runtime-host-base"] },
        version: { type: "number" }
      }
    },
    pid: { type: "number" },
    startedAt: { type: "string" }
  }
};
