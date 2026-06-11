import type { EventStore, MethodRegistry } from "@plastic/core";
import { startBuildHttpTransport } from "./build-http-transport.js";
import type { RuntimeHostControlPlaneDescriptor } from "./runtime-host-control-plane-descriptor.js";
import { startRuntimeHttpTransport } from "./runtime-http-transport.js";
import type { RunPromise } from "./runtime-method-context.js";

export type RuntimeHostTransports = {
  close: () => void;
};

export const startRuntimeHostTransports = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  controlPlane: RuntimeHostControlPlaneDescriptor;
  getBuildStatus: () => unknown;
  runtimeCorsOrigin?: string;
  onRuntimeListening?: () => void;
  onBuildListening?: () => void;
}): Promise<RuntimeHostTransports> => {
  const runtimeTransport = await startRuntimeHttpTransport({
    eventStore: input.eventStore,
    methods: input.methods,
    runPromise: input.runPromise,
    host: input.controlPlane.runtime.host,
    port: input.controlPlane.runtime.port,
    ...(input.runtimeCorsOrigin ? { corsOrigin: input.runtimeCorsOrigin } : {}),
    ...(input.onRuntimeListening ? { onListening: input.onRuntimeListening } : {})
  });
  const buildTransport = await startBuildHttpTransport({
    eventStore: input.eventStore,
    methods: input.methods,
    runPromise: input.runPromise,
    host: input.controlPlane.build.host,
    port: input.controlPlane.build.port,
    getStatus: input.getBuildStatus,
    ...(input.runtimeCorsOrigin ? { corsOrigin: input.runtimeCorsOrigin } : {}),
    ...(input.onBuildListening ? { onListening: input.onBuildListening } : {})
  });

  return {
    close: () => {
      runtimeTransport.close();
      buildTransport.close();
    }
  };
};
