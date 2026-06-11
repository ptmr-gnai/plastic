import { createHeadlessRuntimeCapabilities } from "./runtime-capabilities.js";
import { createRuntimeHostBase } from "./runtime-host-base.js";
import {
  createRuntimeHostAgentModules,
  createRuntimeHostCapabilityModules,
  createRuntimeHostProjectionModules,
  createRuntimeHostStartupModules,
  createRuntimeHostSupportModules
} from "./runtime-host-modules.js";
import { startRuntimeHostControlPlane } from "./runtime-host-control-plane.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";

const {
  hostConfig,
  hostStatus,
  readGitStatus,
  runLocalCommand,
  runtime
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

const projectionModules = createRuntimeHostProjectionModules({
  config: hostConfig,
  mode: "headless",
  bus: { runtimeRpcUrl, runtimePort },
  resource: {
    id: "headless-runtime",
    title: "Plastic Headless Runtime",
    state: buildStatus(),
    rpcUrl: runtimeRpcUrl
  },
  getHostDetails: () => ({
    build: buildStatus(),
    runtime: { windowCount: 0 },
    codex: { connected: false, initialized: false, pid: null, pendingRequests: 0 },
    visibleRefs: []
  })
});
const agentModules = createRuntimeHostAgentModules({
  workbench: {
    mode: "headless",
    workspaceDir,
    eventPath,
    getRuntimeStatus: buildStatus,
    getCodexStatus: () => ({ connected: false, initialized: false, pid: null, pendingRequests: 0 }),
    readGitStatus
  },
  orient: { workspaceDir }
});
const headlessDiagnostics = hostStatus.diagnostics;
const supportModules = createRuntimeHostSupportModules({
  plasticDir,
  getBuildStatus: buildStatus,
  runCommand: runLocalCommand,
  getDiagnostics: () => headlessDiagnostics()
});
const runtimeHealthModule = createRuntimeHealthModule({
  hostChecks: [
    { id: "build:status", run: () => buildStatus() },
    { id: "diagnostics:status", run: () => headlessDiagnostics() },
    { id: "agent-backend:fallback", run: () => runPromise(methods.call("codex/status", {})) }
  ]
});
const capabilityModules = createRuntimeHostCapabilityModules();
const startupModules = createRuntimeHostStartupModules({
  projection: projectionModules,
  agent: agentModules,
  support: supportModules,
  capability: capabilityModules,
  health: runtimeHealthModule
});
const transports = await startRuntimeHostControlPlane({
  workspaceDir,
  bundledExtensionsDir,
  eventStore,
  methods,
  runPromise,
  runtime,
  ...startupModules,
  startedPayload: { mode: "headless" },
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
