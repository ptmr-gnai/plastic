const publicHttpBaseUrl = (host: string, port: number) =>
  `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;

export type RuntimeHostControlPlaneDescriptorInput = {
  runtimeHost: string;
  runtimePort: number;
  buildHost: string;
  buildPort: number;
};

export const createRuntimeHostControlPlaneDescriptor = (
  input: RuntimeHostControlPlaneDescriptorInput
) => {
  const runtimeBaseUrl = publicHttpBaseUrl(input.runtimeHost, input.runtimePort);
  const buildBaseUrl = publicHttpBaseUrl(input.buildHost, input.buildPort);
  return {
    runtime: {
      transport: "http",
      host: input.runtimeHost,
      port: input.runtimePort,
      baseUrl: runtimeBaseUrl,
      rpcPath: "/rpc",
      rpcUrl: `${runtimeBaseUrl}/rpc`,
      statePath: "/state",
      stateUrl: `${runtimeBaseUrl}/state`,
      methodsPath: "/methods",
      methodsUrl: `${runtimeBaseUrl}/methods`,
      hostPath: "/host",
      hostUrl: `${runtimeBaseUrl}/host`,
      capabilitiesPath: "/capabilities",
      capabilitiesUrl: `${runtimeBaseUrl}/capabilities`,
      snapshotPath: "/snapshot",
      snapshotUrl: `${runtimeBaseUrl}/snapshot`,
      selfTestPath: "/self-test",
      selfTestUrl: `${runtimeBaseUrl}/self-test`,
      eventStreamPath: "/events/stream",
      eventStreamUrl: `${runtimeBaseUrl}/events/stream`,
      healthPath: "/healthz",
      healthUrl: `${runtimeBaseUrl}/healthz`
    },
    build: {
      transport: "http",
      host: input.buildHost,
      port: input.buildPort,
      baseUrl: buildBaseUrl,
      rpcPath: "/rpc",
      rpcUrl: `${buildBaseUrl}/rpc`,
      healthPath: "/healthz",
      statePath: "/state",
      stateUrl: `${buildBaseUrl}/state`,
      methodsPath: "/methods",
      methodsUrl: `${buildBaseUrl}/methods`,
      hostPath: "/host",
      hostUrl: `${buildBaseUrl}/host`,
      capabilitiesPath: "/capabilities",
      capabilitiesUrl: `${buildBaseUrl}/capabilities`,
      eventStreamPath: "/events/stream",
      eventStreamUrl: `${buildBaseUrl}/events/stream`,
      statusPath: "/status",
      statusUrl: `${buildBaseUrl}/status`,
      snapshotPath: "/snapshot",
      snapshotUrl: `${buildBaseUrl}/snapshot`,
      selfTestPath: "/self-test",
      selfTestUrl: `${buildBaseUrl}/self-test`,
      healthUrl: `${buildBaseUrl}/healthz`
    }
  };
};

export type RuntimeHostControlPlaneDescriptor = ReturnType<typeof createRuntimeHostControlPlaneDescriptor>;
