import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  prepareBundledExtensionStateAtStartup,
  registerAndActivateExtensionsAtStartup
} from "./extension-startup.js";
import { panelMailboxModule } from "./panel-methods.js";
import type { RuntimeCommandResult } from "./runtime-build-methods.js";
import { createHeadlessRuntimeCapabilities } from "./runtime-capabilities.js";
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
import { createRuntimeModulePlan } from "./runtime-module-plan.js";
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

const execFileAsync = promisify(execFile);
const runtime = await createPlasticRuntime({ workspaceDir, eventPath, capabilities: runtimeCapabilities });
const { eventStore, methods, runPromise } = runtime;

const readGitStatus = async () => {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["status", "--short"], { cwd: workspaceDir });
    return {
      ok: true,
      exitCode: 0,
      files: stdout
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => ({
          status: line.slice(0, 2),
          path: line.slice(3)
        })),
      stderr
    };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return {
      ok: false,
      exitCode: failure.code ?? 1,
      files: [],
      stderr: failure.stderr ?? String(error)
    };
  }
};

const runLocalCommand = async (command: string, args: string[]): Promise<RuntimeCommandResult> => {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd: workspaceDir });
    return { command, args, exitCode: 0, signal: null, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      signal?: NodeJS.Signals | string | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      command,
      args,
      exitCode: failure.code ?? 1,
      signal: failure.signal ?? null,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? String(error)
    };
  }
};

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
await runtime.registerModules([
  ...createRuntimeModulePlan({
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
  })
]);
await registerAndActivateExtensionsAtStartup({ workspaceDir, eventStore, methods, runPromise });
await runtime.registerModules([panelMailboxModule]);
await runtime.appendEvent({
  type: "runtime.started",
  payload: { mode: "headless" }
});

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
