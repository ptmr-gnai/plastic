import { createHeadlessRuntimeCapabilities } from "./runtime-capabilities.js";
import { createRuntimeHostBase } from "./runtime-host-base.js";
import { createRuntimeHostStandardModules } from "./runtime-host-modules.js";
import { startRuntimeHostControlPlane } from "./runtime-host-control-plane.js";

const {
  hostConfig,
  hostStatus,
  readGitStatus,
  runLocalCommand,
  runtime,
  startedPayload
} = await createRuntimeHostBase({
  capabilities: createHeadlessRuntimeCapabilities(),
  mode: "headless",
  service: "plastic.headless",
  getBuildStatusExtra: (config) => ({ runtimePort: config.runtimePort }),
  getDiagnosticsExtra: (config) => ({
    appReady: false,
    windowCount: 0,
    retainedWindowCount: 0,
    viteUrl: null,
    runtimeRpcUrl: config.runtimeRpcUrl,
    runtimePort: config.runtimePort
  })
});
const {
  workspaceDir,
  plasticDir,
  eventPath,
  bundledExtensionsDir,
  runtimePort,
  runtimeRpcUrl,
  controlPlane
} = hostConfig;
const { eventStore, methods, runPromise } = runtime;
const buildStatus = hostStatus.buildStatus;

const headlessDiagnostics = hostStatus.diagnostics;
const startupModules = createRuntimeHostStandardModules({
  config: hostConfig,
  mode: "headless",
  projectionState: buildStatus(),
  getHostDetails: () => ({
    build: buildStatus(),
    runtime: { windowCount: 0 },
    codex: { connected: false, initialized: false, pid: null, pendingRequests: 0 },
    visibleRefs: []
  }),
  agent: {
    workbench: {
      mode: "headless",
      workspaceDir,
      eventPath,
      getRuntimeStatus: buildStatus,
      getCodexStatus: () => ({ connected: false, initialized: false, pid: null, pendingRequests: 0 }),
      readGitStatus
    },
    orient: { workspaceDir }
  },
  support: {
    plasticDir,
    getBuildStatus: buildStatus,
    getHost: hostStatus.host,
    runCommand: runLocalCommand,
    getDiagnostics: () => headlessDiagnostics(),
    healthChecks: [
      { id: "build:status", run: () => buildStatus() },
      { id: "diagnostics:status", run: () => headlessDiagnostics() },
      { id: "agent-backend:fallback", run: () => runPromise(methods.call("codex/status", {})) }
    ]
  }
});
const transports = await startRuntimeHostControlPlane({
  workspaceDir,
  bundledExtensionsDir,
  eventStore,
  methods,
  runPromise,
  runtime,
  ...startupModules,
  startedPayload: startedPayload(),
  controlPlane,
  getBuildStatus: buildStatus,
  onRuntimeListening: () => console.log(`[plastic:headless] RPC listening at ${runtimeRpcUrl}`),
  onBuildListening: () => console.log(`[plastic:headless] Build RPC listening at ${controlPlane.build.rpcUrl}`)
});

process.on("SIGINT", () => {
  transports.close();
  process.exit(130);
});

process.on("SIGTERM", () => {
  transports.close();
  process.exit(143);
});
