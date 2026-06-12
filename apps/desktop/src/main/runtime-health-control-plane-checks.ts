export const invalidControlPlaneUrls = (controlPlane: Record<string, unknown>) => [
  ...invalidEndpointUrls("runtime", asRecord(controlPlane.runtime), [
    "rpc", "state", "methods", "host", "capabilities", "snapshot", "selfTest", "eventStream", "health"
  ]),
  ...invalidEndpointUrls("build", asRecord(controlPlane.build), [
    "rpc", "state", "methods", "host", "capabilities", "eventStream", "health", "status", "snapshot", "selfTest"
  ])
];

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
