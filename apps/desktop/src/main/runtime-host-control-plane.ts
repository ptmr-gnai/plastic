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
  }
): Promise<RuntimeHostTransports> => {
  await runRuntimeStartupSequence({
    ...input,
    startedPayload: {
      ...input.startedPayload,
      controlPlane: {
        runtime: {
          transport: "http",
          host: input.runtimeHost,
          port: input.runtimePort,
          rpcPath: "/rpc",
          statePath: "/state",
          methodsPath: "/methods",
          eventStreamPath: "/events/stream",
          healthPath: "/healthz"
        },
        build: {
          transport: "http",
          host: input.buildHost,
          port: input.buildPort,
          rpcPath: "/rpc",
          healthPath: "/healthz",
          statePath: "/state",
          methodsPath: "/methods",
          eventStreamPath: "/events/stream",
          statusPath: "/status",
          snapshotPath: "/snapshot"
        }
      }
    }
  });
  input.onPhase?.("start sockets");

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
