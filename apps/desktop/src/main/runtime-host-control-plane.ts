import {
  runRuntimeStartupSequence,
  type RuntimeStartupSequenceInput
} from "./runtime-startup.js";
import {
  startRuntimeHostTransports,
  type RuntimeHostTransports
} from "./runtime-host-transports.js";
import type { RuntimeHostControlPlaneDescriptor } from "./runtime-host-control-plane-descriptor.js";

export const startRuntimeHostControlPlane = async (
  input: RuntimeStartupSequenceInput & {
    controlPlane: RuntimeHostControlPlaneDescriptor;
    getBuildStatus: () => unknown;
    runtimeCorsOrigin?: string;
    onRuntimeListening?: () => void;
    onBuildListening?: () => void;
  }
): Promise<RuntimeHostTransports> => {
  await runRuntimeStartupSequence({
    ...input,
    startedPayload: {
      ...input.startedPayload,
      controlPlane: input.controlPlane
    }
  });
  input.onPhase?.("start sockets");

  return startRuntimeHostTransports({
    eventStore: input.eventStore,
    methods: input.methods,
    runPromise: input.runPromise,
    controlPlane: input.controlPlane,
    getBuildStatus: input.getBuildStatus,
    ...(input.runtimeCorsOrigin ? { runtimeCorsOrigin: input.runtimeCorsOrigin } : {}),
    ...(input.onRuntimeListening ? { onRuntimeListening: input.onRuntimeListening } : {}),
    ...(input.onBuildListening ? { onBuildListening: input.onBuildListening } : {})
  });
};
