import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAgentOrientModule } from "./agent-orient-methods.js";
import { createAgentWorkbenchModule } from "./agent-workbench-methods.js";
import { createDeixisMethodModule } from "./deixis-methods.js";
import {
  prepareBundledExtensionStateAtStartup,
  registerAndActivateExtensionsAtStartup
} from "./extension-startup.js";
import { createExtensionAuthoringModule } from "./extension-authoring-methods.js";
import { panelMailboxModule } from "./panel-methods.js";
import { createRendererControlModule } from "./renderer-control-methods.js";
import { createRuntimeBuildModule, type RuntimeCommandResult } from "./runtime-build-methods.js";
import { createHeadlessRuntimeCapabilities } from "./runtime-capabilities.js";
import { createRuntimeDiagnosticsModule } from "./runtime-diagnostics-methods.js";
import { createRuntimeHostConfig } from "./runtime-host-config.js";
import { createRuntimeBuildStatus, createRuntimeDiagnostics } from "./runtime-host-status.js";
import { startRuntimeHostTransports } from "./runtime-host-transports.js";
import { createPlasticRuntime } from "./runtime-kernel.js";
import { createRuntimeModulePlan } from "./runtime-module-plan.js";
import { createRuntimeSnapshotModule } from "./runtime-snapshot-methods.js";
import { createRuntimeStateModule } from "./runtime-state-methods.js";
import { createWindowCapabilityModule } from "./window-capability-methods.js";

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
  decorateState: (state) => ({
    ...state,
    app: { ...state.app, mode: "headless" },
    bus: { runtimeRpcUrl, runtimePort },
    resources: [
      ...state.resources,
      {
        id: "headless-runtime",
        kind: "service",
        title: "Plastic Headless Runtime",
        state: buildStatus(),
        links: [
          { rel: "rpc", href: runtimeRpcUrl, method: "http/post" },
          { rel: "state", href: "plastic/state", method: "plastic/state" },
          { rel: "methods", href: "plastic/methods", method: "plastic/methods" }
        ],
        actions: [{ id: "call", title: "Call RPC method", method: "rpc/call" }]
      }
    ]
  })
});
const runtimeSnapshotModule = createRuntimeSnapshotModule({
  getHostDetails: () => ({
    app: { name: "Plastic", mode: "headless", workspaceDir, eventPath },
    build: buildStatus(),
    runtime: { windowCount: 0 },
    codex: { connected: false, initialized: false, pid: null, pendingRequests: 0 },
    visibleRefs: []
  })
});
const agentWorkbenchModule = createAgentWorkbenchModule({
  mode: "headless",
  workspaceDir,
  eventPath,
  getRuntimeStatus: buildStatus,
  getCodexStatus: () => ({ connected: false, initialized: false, pid: null, pendingRequests: 0 }),
  readGitStatus
});
const agentOrientModule = createAgentOrientModule({ workspaceDir });
const runtimeBuildModule = createRuntimeBuildModule({
  getStatus: buildStatus,
  runCommand: runLocalCommand
});
const runtimeDiagnosticsModule = createRuntimeDiagnosticsModule({
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
const extensionAuthoringModule = createExtensionAuthoringModule({ plasticDir });
const rendererControlModule = createRendererControlModule({});
const windowCapabilityModule = createWindowCapabilityModule();
const deixisMethodModule = createDeixisMethodModule();
await runtime.registerModules([
  ...createRuntimeModulePlan({
    state: runtimeStateModule,
    snapshot: runtimeSnapshotModule,
    agentWorkbench: agentWorkbenchModule,
    agentOrient: agentOrientModule,
    build: runtimeBuildModule,
    diagnostics: runtimeDiagnosticsModule,
    extensionAuthoring: extensionAuthoringModule,
    rendererControl: rendererControlModule,
    windowCapability: windowCapabilityModule,
    deixis: deixisMethodModule
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
