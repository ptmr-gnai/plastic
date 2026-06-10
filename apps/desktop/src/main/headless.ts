import {
  prepareBundledExtensionStateAtStartup
} from "./extension-startup.js";
import { createHeadlessRuntimeCapabilities } from "./runtime-capabilities.js";
import { createGitStatusReader, createWorkspaceCommandRunner } from "./runtime-host-command.js";
import { createRuntimeHostConfig } from "./runtime-host-config.js";
import {
  createRuntimeHostAgentModules,
  createRuntimeHostCapabilityModules,
  createRuntimeHostSupportModules
} from "./runtime-host-modules.js";
import {
  createRuntimeBuildStatus,
  createRuntimeDiagnostics,
  createSnapshotAppDetails,
  decorateRuntimeState
} from "./runtime-host-status.js";
import { startRuntimeHostTransports } from "./runtime-host-transports.js";
import { createPlasticRuntime } from "./runtime-kernel.js";
import { appendRuntimeStartedEvent, registerCoreRuntimeModulesAtStartup } from "./runtime-startup.js";
import { createRuntimeSnapshotModule } from "./runtime-snapshot-methods.js";
import { createRuntimeStateModule } from "./runtime-state-methods.js";

const hostConfig = createRuntimeHostConfig();
const {
  workspaceDir,
  plasticDir,
  eventPath,
  bundledExtensionsDir,
  runtimeHost,
  runtimePort,
  runtimeRpcUrl,
  buildHost,
  buildPort
} = hostConfig;
const startedAt = new Date().toISOString();
const runtimeCapabilities = createHeadlessRuntimeCapabilities();

const runtime = await createPlasticRuntime({ workspaceDir, eventPath, capabilities: runtimeCapabilities });
const { eventStore, methods, runPromise } = runtime;
const runLocalCommand = createWorkspaceCommandRunner(workspaceDir);
const readGitStatus = createGitStatusReader({ runCommand: runLocalCommand });

const buildStatus = () => createRuntimeBuildStatus({
  config: hostConfig,
  service: "plastic.headless",
  startedAt,
  runtimeRpcUrl,
  runtimePort
});

await prepareBundledExtensionStateAtStartup({ workspaceDir, bundledExtensionsDir, eventStore, runPromise });
const runtimeStateModule = createRuntimeStateModule({
  decorateState: (state) => decorateRuntimeState({
    state,
    mode: "headless",
    bus: { runtimeRpcUrl, runtimePort },
    resource: {
      id: "headless-runtime",
      title: "Plastic Headless Runtime",
      state: buildStatus(),
      rpcUrl: runtimeRpcUrl
    }
  })
});
const runtimeSnapshotModule = createRuntimeSnapshotModule({
  getHostDetails: () => ({
    app: createSnapshotAppDetails({ config: hostConfig, mode: "headless" }),
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
const supportModules = createRuntimeHostSupportModules({
  plasticDir,
  getBuildStatus: buildStatus,
  runCommand: runLocalCommand,
  getDiagnostics: () => createRuntimeDiagnostics({
    config: hostConfig,
    appReady: false,
    windowCount: 0,
    retainedWindowCount: 0,
    viteUrl: null,
    runtimeRpcUrl,
    runtimePort
  })
});
const capabilityModules = createRuntimeHostCapabilityModules();
await registerCoreRuntimeModulesAtStartup({
  workspaceDir,
  eventStore,
  methods,
  runPromise,
  runtime,
  state: runtimeStateModule,
  snapshot: runtimeSnapshotModule,
  agentWorkbench: agentModules.agentWorkbench,
  agentOrient: agentModules.agentOrient,
  build: supportModules.build,
  diagnostics: supportModules.diagnostics,
  extensionAuthoring: supportModules.extensionAuthoring,
  rendererControl: capabilityModules.rendererControl,
  windowCapability: capabilityModules.windowCapability,
  deixis: capabilityModules.deixis
});
await appendRuntimeStartedEvent(runtime, { mode: "headless" });

const transports = await startRuntimeHostTransports({
  eventStore,
  methods,
  runPromise,
  runtimeHost,
  runtimePort,
  buildHost,
  buildPort,
  getBuildStatus: buildStatus,
  onRuntimeListening: () => console.log(`[plastic:headless] RPC listening at ${runtimeRpcUrl}`),
  onBuildListening: () => console.log(`[plastic:headless] Build RPC listening at http://${buildHost}:${buildPort}/rpc`)
});

process.on("SIGINT", () => {
  transports.close();
  process.exit(130);
});

process.on("SIGTERM", () => {
  transports.close();
  process.exit(143);
});
