import {
  runRuntimeStartupSequence,
  type RuntimeStartupSequenceInput
} from "./runtime-startup.js";
import {
  startRuntimeHostTransports,
  type RuntimeHostTransports
} from "./runtime-host-transports.js";

export const startRuntimeHostControlPlane = async (
  input: RuntimeStartupSequenceInput & {
    runtimeHost: string;
    runtimePort: number;
    buildHost: string;
    buildPort: number;
    getBuildStatus: () => unknown;
    runtimeCorsOrigin?: string;
    onRuntimeListening?: () => void;
    onBuildListening?: () => void;
    onBeforeTransports?: () => void;
  }
): Promise<RuntimeHostTransports> => {
  await runRuntimeStartupSequence(input);
  input.onBeforeTransports?.();

  return startRuntimeHostTransports({
    eventStore: input.eventStore,
    methods: input.methods,
    runPromise: input.runPromise,
    runtimeHost: input.runtimeHost,
    runtimePort: input.runtimePort,
    buildHost: input.buildHost,
    buildPort: input.buildPort,
    getBuildStatus: input.getBuildStatus,
    ...(input.runtimeCorsOrigin ? { runtimeCorsOrigin: input.runtimeCorsOrigin } : {}),
    ...(input.onRuntimeListening ? { onRuntimeListening: input.onRuntimeListening } : {}),
    ...(input.onBuildListening ? { onBuildListening: input.onBuildListening } : {})
  });
};
