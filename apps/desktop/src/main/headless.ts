import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type EventStore
} from "@plastic/core";
import { agentBackendFallbackModule } from "./agent-backend-fallback-methods.js";
import { createAgentOrientModule } from "./agent-orient-methods.js";
import { createAgentWorkbenchModule } from "./agent-workbench-methods.js";
import { createExtensionAuthoringModule } from "./extension-authoring-methods.js";
import { activateExtensions } from "./extension-host.js";
import { registerExtensionMethods, scanBundledExtensions, scanWorkspaceExtensions } from "./extension-loader.js";
import { headlessCapabilityModule } from "./headless-capability-methods.js";
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

const appendEvent = async (_store: EventStore, eventInput: Parameters<typeof runtime.appendEvent>[0]) =>
  runtime.appendEvent(eventInput);

const buildStatus = () => ({
  service: "plastic.headless",
  status: "running",
  workspaceDir,
  plasticDir,
  dataDir: runtimePaths.dataDir,
  eventPath,
  runtimeRpcUrl,
  runtimePort,
  pid: process.pid,
  startedAt
});

const discoverExtensionsAtStartup = async () => {
  for (const extension of await scanBundledExtensions(workspaceDir, bundledExtensionsDir)) {
    await appendEvent(eventStore, {
      type: "extension.discovered",
      payload: {
        id: extension.id,
        title: extension.title,
        source: extension.source,
        path: extension.path,
        entry: extension.entry,
        manifestPath: extension.manifestPath,
        manifest: extension,
        errors: extension.errors
      },
      scope: { extensionId: extension.id }
    });
  }

  for (const extension of await scanWorkspaceExtensions(workspaceDir)) {
    await appendEvent(eventStore, {
      type: "extension.discovered",
      payload: {
        id: extension.id,
        title: extension.title,
        source: extension.source,
        path: extension.path,
        entry: extension.entry,
        manifestPath: extension.manifestPath,
        manifest: {
          id: extension.id,
          title: extension.title,
          panels: extension.panels,
          renderers: extension.renderers,
          methods: extension.methods
        },
        errors: extension.errors
      },
      scope: { extensionId: extension.id }
    });
  }
};

await discoverExtensionsAtStartup();
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
  headlessCapabilityModule,
  runtimeHealthModule
]);
await registerExtensionMethods({ workspaceDir, eventStore, methods, runPromise });
await activateExtensions({ workspaceDir, eventStore, methods, runPromise });
await runtime.registerModules([panelMailboxModule]);
await appendEvent(eventStore, {
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

process.on("SIGINT", () => {
  runtimeTransport.close();
  process.exit(130);
});

process.on("SIGTERM", () => {
  runtimeTransport.close();
  process.exit(143);
});
