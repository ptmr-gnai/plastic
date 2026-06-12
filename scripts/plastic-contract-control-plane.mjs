import { stableJson } from "./plastic-stable-json.mjs";

export const assertControlPlaneEndpointUrls = ({ assert, controlPlane, source }) => {
  assert(controlPlane?.runtime?.baseUrl?.startsWith("http://"), `${source} runtime baseUrl missing`);
  assert(controlPlane.runtime.rpcUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.rpcPath}`, `${source} runtime rpcUrl mismatch`);
  assert(controlPlane.runtime.stateUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.statePath}`, `${source} runtime stateUrl mismatch`);
  assert(controlPlane.runtime.methodsUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.methodsPath}`, `${source} runtime methodsUrl mismatch`);
  assert(controlPlane.runtime.hostUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.hostPath}`, `${source} runtime hostUrl mismatch`);
  assert(controlPlane.runtime.capabilitiesUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.capabilitiesPath}`, `${source} runtime capabilitiesUrl mismatch`);
  assert(controlPlane.runtime.snapshotUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.snapshotPath}`, `${source} runtime snapshotUrl mismatch`);
  assert(controlPlane.runtime.selfTestUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.selfTestPath}`, `${source} runtime selfTestUrl mismatch`);
  assert(controlPlane.runtime.eventStreamUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.eventStreamPath}`, `${source} runtime eventStreamUrl mismatch`);
  assert(controlPlane.runtime.healthUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.healthPath}`, `${source} runtime healthUrl mismatch`);
  assert(controlPlane?.build?.baseUrl?.startsWith("http://"), `${source} build baseUrl missing`);
  assert(controlPlane.build.rpcUrl === `${controlPlane.build.baseUrl}${controlPlane.build.rpcPath}`, `${source} build rpcUrl mismatch`);
  assert(controlPlane.build.stateUrl === `${controlPlane.build.baseUrl}${controlPlane.build.statePath}`, `${source} build stateUrl mismatch`);
  assert(controlPlane.build.methodsUrl === `${controlPlane.build.baseUrl}${controlPlane.build.methodsPath}`, `${source} build methodsUrl mismatch`);
  assert(controlPlane.build.hostUrl === `${controlPlane.build.baseUrl}${controlPlane.build.hostPath}`, `${source} build hostUrl mismatch`);
  assert(controlPlane.build.capabilitiesUrl === `${controlPlane.build.baseUrl}${controlPlane.build.capabilitiesPath}`, `${source} build capabilitiesUrl mismatch`);
  assert(controlPlane.build.eventStreamUrl === `${controlPlane.build.baseUrl}${controlPlane.build.eventStreamPath}`, `${source} build eventStreamUrl mismatch`);
  assert(controlPlane.build.healthUrl === `${controlPlane.build.baseUrl}${controlPlane.build.healthPath}`, `${source} build healthUrl mismatch`);
  assert(controlPlane.build.statusUrl === `${controlPlane.build.baseUrl}${controlPlane.build.statusPath}`, `${source} build statusUrl mismatch`);
  assert(controlPlane.build.snapshotUrl === `${controlPlane.build.baseUrl}${controlPlane.build.snapshotPath}`, `${source} build snapshotUrl mismatch`);
  assert(controlPlane.build.selfTestUrl === `${controlPlane.build.baseUrl}${controlPlane.build.selfTestPath}`, `${source} build selfTestUrl mismatch`);
};

export const controlPlaneDescriptor = (controlPlane) => ({
  runtime: controlPlane?.runtime ?? null,
  build: controlPlane?.build ?? null
});

export const assertMatchingControlPlaneDescriptors = ({ assert, actual, expected, source }) => {
  assert(
    stableJson(controlPlaneDescriptor(actual)) === stableJson(controlPlaneDescriptor(expected)),
    `${source} control plane does not match runtime.started`
  );
};
