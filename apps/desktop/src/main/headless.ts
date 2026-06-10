import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { agentBackendFallbackModule } from "./agent-backend-fallback-methods.js";
import { createAgentOrientModule } from "./agent-orient-methods.js";
import { createAgentWorkbenchModule } from "./agent-workbench-methods.js";
import { startBuildHttpTransport } from "./build-http-transport.js";
import { createDeixisMethodModule } from "./deixis-methods.js";
import {
  discoverBundledExtensionsAtStartup,
  discoverWorkspaceExtensionsAtStartup,
  ensureBundledPanelsAtStartup,
  ensurePanelRendererBindingsAtStartup
} from "./extension-startup.js";
import { createExtensionAuthoringModule } from "./extension-authoring-methods.js";
import { activateExtensions } from "./extension-host.js";
import { registerExtensionMethods } from "./extension-loader.js";
import { panelControlModule } from "./panel-control-methods.js";
import { panelMailboxModule } from "./panel-methods.js";
import { createRendererControlModule } from "./renderer-control-methods.js";
import { createRuntimeBuildModule, type RuntimeCommandResult } from "./runtime-build-methods.js";
import { startRuntimeHttpTransport } from "./runtime-http-transport.js";
import { runtimeControlModule } from "./runtime-control-methods.js";
import { createRuntimeDiagnosticsModule } from "./runtime-diagnostics-methods.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";
import { createPlasticRuntime } from "./runtime-kernel.js";
import { createRuntimeSnapshotModule } from "./runtime-snapshot-methods.js";
import { createRuntimeStateModule } from "./runtime-state-methods.js";
import { resolvePlasticRuntimePaths } from "./runtime-paths.js";
import { createWindowCapabilityModule } from "./window-capability-methods.js";

const workspaceDir = process.env.PLASTIC_WORKSPACE_DIR ?? process.cwd();
const plasticDir = join(workspaceDir, ".plastic");
const runtimePaths = resolvePlasticRuntimePaths(workspaceDir);
const eventPath = runtimePaths.eventPath;
const bundledExtensionsDir = join(workspaceDir, "apps", "desktop", "extensions", "bundled");
const runtimeHost = process.env.PLASTIC_RUNTIME_HOST ?? "0.0.0.0";
const runtimePort = Number(process.env.PLASTIC_RUNTIME_PORT ?? 7331);
const runtimeRpcUrl = process.env.PLASTIC_RPC_URL ?? `http://127.0.0.1:${runtimePort}/rpc`;
const buildHost = process.env.PLASTIC_BUILD_HOST ?? "127.0.0.1";
const buildPort = Number(process.env.PLASTIC_BUILD_PORT ?? 7332);
const startedAt = new Date().toISOString();
const runtimeCapabilities = [
  { id: "runtime.capabilities", title: "Runtime capability registry", status: "available" as const },
  { id: "window.projection", title: "Window projection", status: "available" as const },
  { id: "event.projection", title: "Event projection", status: "available" as const },
  { id: "electron.window", title: "Electron windows", status: "unavailable" as const, notes: "Headless mode has no Electron BrowserWindow host." },
  { id: "dom.refs", title: "DOM visible refs", status: "unavailable" as const, notes: "Headless mode has no rendered DOM projection." },
  { id: "dom.eval", title: "DOM evaluation", status: "unavailable" as const, notes: "Headless mode has no renderer DOM." },
  { id: "dom.input", title: "DOM input control", status: "unavailable" as const, notes: "Headless mode has no rendered input elements." },
  { id: "screenshot", title: "Window screenshot capture", status: "unavailable" as const, notes: "Headless mode has no screenshot provider." },
  { id: "agent.codex", title: "Codex agent backend", status: "unavailable" as const, notes: "Headless mode has no Codex app-server adapter attached yet." }
];

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

const buildStatus = () => ({
  service: "plastic.headless",
  status: "running",
  workspaceDir,
  plasticDir,
  dataDir: runtimePaths.dataDir,
  eventPath,
  runtimeRpcUrl,
  runtimePort,
  buildSocket: `http://${buildHost}:${buildPort}`,
  pid: process.pid,
  startedAt
});

await discoverBundledExtensionsAtStartup({ workspaceDir, bundledExtensionsDir, eventStore, runPromise });
await ensureBundledPanelsAtStartup({ workspaceDir, eventStore, runPromise });
await ensurePanelRendererBindingsAtStartup({ workspaceDir, eventStore, runPromise });
await discoverWorkspaceExtensionsAtStartup({ workspaceDir, eventStore, runPromise });
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
const runtimeHealthModule = createRuntimeHealthModule();
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
  getDiagnostics: () => ({
    cwd: process.cwd(),
    workspaceDir,
    eventPath,
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
  runtimeStateModule,
  runtimeSnapshotModule,
  agentWorkbenchModule,
  agentOrientModule,
  runtimeBuildModule,
  runtimeDiagnosticsModule,
  extensionAuthoringModule,
  rendererControlModule,
  agentBackendFallbackModule,
  runtimeControlModule,
  panelControlModule,
  windowCapabilityModule,
  deixisMethodModule,
  runtimeHealthModule
]);
await registerExtensionMethods({ workspaceDir, eventStore, methods, runPromise });
await activateExtensions({ workspaceDir, eventStore, methods, runPromise });
await runtime.registerModules([panelMailboxModule]);
await runtime.appendEvent({
  type: "runtime.started",
  payload: { mode: "headless" }
});

const runtimeTransport = await startRuntimeHttpTransport({
  eventStore,
  methods,
  runPromise,
  host: runtimeHost,
  port: runtimePort,
  onListening: () => {
    console.log(`[plastic:headless] RPC listening at ${runtimeRpcUrl}`);
  }
});
const buildTransport = startBuildHttpTransport({
  methods,
  runPromise,
  host: buildHost,
  port: buildPort,
  getStatus: buildStatus,
  onListening: () => {
    console.log(`[plastic:headless] Build RPC listening at http://${buildHost}:${buildPort}/rpc`);
  }
});

process.on("SIGINT", () => {
  runtimeTransport.close();
  buildTransport.close();
  process.exit(130);
});

process.on("SIGTERM", () => {
  runtimeTransport.close();
  buildTransport.close();
  process.exit(143);
});
