import { stableJson } from "./plastic-stable-json.mjs";

export const assertControlPlaneEndpointUrls = ({ assert, controlPlane, source }) => {
  assert(controlPlane?.runtime?.baseUrl?.startsWith("http://"), `${source} runtime baseUrl missing`);
  assert(controlPlane.runtime.rpcUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.rpcPath}`, `${source} runtime rpcUrl mismatch`);
  assert(controlPlane.runtime.stateUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.statePath}`, `${source} runtime stateUrl mismatch`);
  assert(controlPlane.runtime.methodsUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.methodsPath}`, `${source} runtime methodsUrl mismatch`);
  assert(controlPlane.runtime.eventStreamUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.eventStreamPath}`, `${source} runtime eventStreamUrl mismatch`);
  assert(controlPlane.runtime.healthUrl === `${controlPlane.runtime.baseUrl}${controlPlane.runtime.healthPath}`, `${source} runtime healthUrl mismatch`);
  assert(controlPlane?.build?.baseUrl?.startsWith("http://"), `${source} build baseUrl missing`);
  assert(controlPlane.build.rpcUrl === `${controlPlane.build.baseUrl}${controlPlane.build.rpcPath}`, `${source} build rpcUrl mismatch`);
  assert(controlPlane.build.stateUrl === `${controlPlane.build.baseUrl}${controlPlane.build.statePath}`, `${source} build stateUrl mismatch`);
  assert(controlPlane.build.methodsUrl === `${controlPlane.build.baseUrl}${controlPlane.build.methodsPath}`, `${source} build methodsUrl mismatch`);
  assert(controlPlane.build.eventStreamUrl === `${controlPlane.build.baseUrl}${controlPlane.build.eventStreamPath}`, `${source} build eventStreamUrl mismatch`);
  assert(controlPlane.build.healthUrl === `${controlPlane.build.baseUrl}${controlPlane.build.healthPath}`, `${source} build healthUrl mismatch`);
  assert(controlPlane.build.statusUrl === `${controlPlane.build.baseUrl}${controlPlane.build.statusPath}`, `${source} build statusUrl mismatch`);
  assert(controlPlane.build.snapshotUrl === `${controlPlane.build.baseUrl}${controlPlane.build.snapshotPath}`, `${source} build snapshotUrl mismatch`);
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
