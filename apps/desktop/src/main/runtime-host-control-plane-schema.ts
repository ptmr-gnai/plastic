const httpControlPlaneSideSchema = {
  type: "object",
  required: [
    "transport",
    "host",
    "port",
    "baseUrl",
    "rpcPath",
    "rpcUrl",
    "statePath",
    "stateUrl",
    "methodsPath",
    "methodsUrl",
    "hostPath",
    "hostUrl",
    "capabilitiesPath",
    "capabilitiesUrl",
    "eventStreamPath",
    "eventStreamUrl",
    "snapshotPath",
    "snapshotUrl",
    "selfTestPath",
    "selfTestUrl",
    "healthPath",
    "healthUrl"
  ],
  properties: {
    transport: { type: "string", enum: ["http"] },
    host: { type: "string" },
    port: { type: "number" },
    baseUrl: { type: "string" },
    rpcPath: { type: "string", enum: ["/rpc"] },
    rpcUrl: { type: "string" },
    statePath: { type: "string", enum: ["/state"] },
    stateUrl: { type: "string" },
    methodsPath: { type: "string", enum: ["/methods"] },
    methodsUrl: { type: "string" },
    hostPath: { type: "string", enum: ["/host"] },
    hostUrl: { type: "string" },
    capabilitiesPath: { type: "string", enum: ["/capabilities"] },
    capabilitiesUrl: { type: "string" },
    eventStreamPath: { type: "string", enum: ["/events/stream"] },
    eventStreamUrl: { type: "string" },
    snapshotPath: { type: "string", enum: ["/snapshot"] },
    snapshotUrl: { type: "string" },
    selfTestPath: { type: "string", enum: ["/self-test"] },
    selfTestUrl: { type: "string" },
    healthPath: { type: "string", enum: ["/healthz"] },
    healthUrl: { type: "string" }
  }
};

const buildControlPlaneSideSchema = {
  ...httpControlPlaneSideSchema,
  required: [...httpControlPlaneSideSchema.required, "statusPath", "statusUrl"],
  properties: {
    ...httpControlPlaneSideSchema.properties,
    statusPath: { type: "string", enum: ["/status"] },
    statusUrl: { type: "string" }
  }
};

export const runtimeHostControlPlaneSchema = {
  type: "object",
  required: ["runtime", "build"],
  properties: {
    runtime: httpControlPlaneSideSchema,
    build: buildControlPlaneSideSchema
  }
};
