import { createHeadlessRuntimeCapabilities } from "./runtime-capabilities.js";
import { createGitStatusReader, createWorkspaceCommandRunner } from "./runtime-host-command.js";
import { createRuntimeHostConfig } from "./runtime-host-config.js";
import {
  createRuntimeHostAgentModules,
  createRuntimeHostCapabilityModules,
  createRuntimeHostProjectionModules,
  createRuntimeHostSupportModules
} from "./runtime-host-modules.js";
import {
  createRuntimeBuildStatus,
  createRuntimeDiagnostics,
} from "./runtime-host-status.js";
import { startRuntimeHostControlPlane } from "./runtime-host-control-plane.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";
import { createPlasticRuntime } from "./runtime-kernel.js";

const hostConfig = createRuntimeHostConfig();
const {
  workspaceDir,
  plasticDir,
  eventPath,
  bundledExtensionsDir,
  runtimePort,
  runtimeRpcUrl,
  controlPlane
} = hostConfig;
const startedAt = new Date().toISOString();
const runtimeCapabilities = createHeadlessRuntimeCapabilities();

const runtime = await createPlasticRuntime({ workspaceDir, eventPath, capabilities: runtimeCapabilities });
const { eventStore, methods, runPromise } = runtime;
const runLocalCommand = createWorkspaceCommandRunner(workspaceDir);
const readGitStatus = createGitStatusReader({ runCommand: runLocalCommand });

const buildStatus = () => createRuntimeBuildStatus({
  config: hostConfig,
  mode: "headless",
  service: "plastic.headless",
  startedAt,
  runtimeRpcUrl,
  runtimePort
});

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
const headlessDiagnostics = () => createRuntimeDiagnostics({
  config: hostConfig,
  mode: "headless",
  appReady: false,
  windowCount: 0,
  retainedWindowCount: 0,
  viteUrl: null,
  runtimeRpcUrl,
  runtimePort
});
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
const transports = await startRuntimeHostControlPlane({
  workspaceDir,
  bundledExtensionsDir,
  eventStore,
  methods,
  runPromise,
  runtime,
  state: projectionModules.state,
  snapshot: projectionModules.snapshot,
  agentWorkbench: agentModules.agentWorkbench,
  agentOrient: agentModules.agentOrient,
  build: supportModules.build,
  diagnostics: supportModules.diagnostics,
  extensionAuthoring: supportModules.extensionAuthoring,
  rendererControl: capabilityModules.rendererControl,
  windowCapability: capabilityModules.windowCapability,
  deixis: capabilityModules.deixis,
  health: runtimeHealthModule,
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
