const runtimePaths = {
  rpcPath: "/rpc",
  statePath: "/state",
  methodsPath: "/methods",
  hostPath: "/host",
  capabilitiesPath: "/capabilities",
  snapshotPath: "/snapshot",
  selfTestPath: "/self-test",
  eventStreamPath: "/events/stream",
  healthPath: "/healthz"
};

const buildPaths = {
  rpcPath: "/rpc",
  statePath: "/state",
  methodsPath: "/methods",
  hostPath: "/host",
  capabilitiesPath: "/capabilities",
  eventStreamPath: "/events/stream",
  healthPath: "/healthz",
  statusPath: "/status",
  snapshotPath: "/snapshot",
  selfTestPath: "/self-test"
};

export const invalidControlPlaneUrls = (controlPlane: Record<string, unknown>) => {
  const runtime = asRecord(controlPlane.runtime);
  const build = asRecord(controlPlane.build);
  return [
    ...invalidPlaneShape("runtime", runtime, runtimePaths),
    ...invalidEndpointUrls("runtime", runtime, [
      "rpc", "state", "methods", "host", "capabilities", "snapshot", "selfTest", "eventStream", "health"
    ]),
    ...invalidPlaneShape("build", build, buildPaths),
    ...invalidEndpointUrls("build", build, [
      "rpc", "state", "methods", "host", "capabilities", "eventStream", "health", "status", "snapshot", "selfTest"
    ])
  ];
};

const invalidPlaneShape = (
  prefix: string,
  plane: Record<string, unknown>,
  expectedPaths: Record<string, string>
) => [
  plane.transport !== "http" ? `${prefix}.transport` : null,
  typeof plane.host !== "string" || plane.host.length === 0 ? `${prefix}.host` : null,
  typeof plane.port !== "number" ? `${prefix}.port` : null,
  ...Object.entries(expectedPaths)
    .filter(([key, value]) => plane[key] !== value)
    .map(([key]) => `${prefix}.${key}`)
].filter((item): item is string => Boolean(item));

const invalidEndpointUrls = (prefix: string, plane: Record<string, unknown>, names: string[]) =>
  names
    .filter((name) => {
      const path = plane[`${name}Path`];
      const url = plane[`${name}Url`];
      return typeof plane.baseUrl !== "string"
        || typeof path !== "string"
        || url !== `${plane.baseUrl}${path}`;
    })
    .map((name) => `${prefix}.${name}Url`);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
