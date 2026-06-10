import { createRequire } from "node:module";
import { spawn as spawnProcess } from "node:child_process";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import { Effect } from "effect";
import {
  createEvent,
  eventSummary,
  isNoisyEvent,
  type EventScopeInput
} from "@plastic/core";
import { ipcChannels, type RpcRequest, type RpcResponse } from "../shared/ipc.js";
import { createAgentOrientModule } from "./agent-orient-methods.js";
import { createAgentWorkbenchModule } from "./agent-workbench-methods.js";
import { startBuildHttpTransport } from "./build-http-transport.js";
import { createCodexAdapter } from "./codex-adapter.js";
import { createDeixisMethodModule } from "./deixis-methods.js";
import { createElectronDeixisHost } from "./electron-deixis-host.js";
import {
  discoverBundledExtensionsAtStartup,
  discoverWorkspaceExtensionsAtStartup,
  ensureBundledPanelsAtStartup,
  ensurePanelRendererBindingsAtStartup
} from "./extension-startup.js";
import { createExtensionAuthoringModule } from "./extension-authoring-methods.js";
import { activateExtensions } from "./extension-host.js";
import { registerExtensionMethods } from "./extension-loader.js";
import { panelMailboxModule } from "./panel-methods.js";
import { createRendererControlModule } from "./renderer-control-methods.js";
import { startRuntimeHttpTransport } from "./runtime-http-transport.js";
import { createRuntimeBuildModule } from "./runtime-build-methods.js";
import { createElectronRuntimeCapabilities } from "./runtime-capabilities.js";
import { createRuntimeDiagnosticsModule } from "./runtime-diagnostics-methods.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";
import { createPlasticRuntime } from "./runtime-kernel.js";
import { createRuntimeModulePlan } from "./runtime-module-plan.js";
import { createRuntimeSnapshotModule } from "./runtime-snapshot-methods.js";
import { createRuntimeStateModule } from "./runtime-state-methods.js";
import { resolvePlasticRuntimePaths } from "./runtime-paths.js";
import { createWindowCapabilityModule } from "./window-capability-methods.js";

const require = createRequire(import.meta.url);
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, ipcMain } = electron;
const workspaceDir = process.env.PLASTIC_WORKSPACE_DIR ?? process.cwd();
const plasticDir = join(workspaceDir, ".plastic");
const bundledExtensionsDir = join(workspaceDir, "apps", "desktop", "extensions", "bundled");
const runtimePaths = resolvePlasticRuntimePaths(workspaceDir);
const eventPath = runtimePaths.eventPath;

const logStartup = (stage: string) => {
  console.log(`[plastic:startup] ${stage}`);
};

const runLocalCommand = async (command: string, args: string[]) =>
  new Promise<{ command: string; args: string[]; exitCode: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawnProcess(command, args, {
      cwd: workspaceDir,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (exitCode, signal) => {
      resolve({ command, args, exitCode, signal, stdout, stderr });
    });
  });

const windows = new Set<ElectronBrowserWindow>();
const processStartedAt = new Date().toISOString();
const runtimeHost = process.env.PLASTIC_RUNTIME_HOST ?? "0.0.0.0";
const runtimePort = Number(process.env.PLASTIC_RUNTIME_PORT ?? 7331);
const buildHost = process.env.PLASTIC_BUILD_HOST ?? "127.0.0.1";
const buildPort = Number(process.env.PLASTIC_BUILD_PORT ?? 7332);

const getHostRpcUrls = () => {
  const urls = [`http://127.0.0.1:${runtimePort}/rpc`];
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const candidate of interfaces ?? []) {
      if (candidate.family === "IPv4" && !candidate.internal) {
        urls.push(`http://${candidate.address}:${runtimePort}/rpc`);
      }
    }
  }
  urls.push(`http://host.docker.internal:${runtimePort}/rpc`);
  return [...new Set(urls)];
};

const runtimeRpcUrls = getHostRpcUrls();
const preferredRuntimeRpcUrl = process.env.PLASTIC_RPC_URL ?? runtimeRpcUrls[1] ?? runtimeRpcUrls[0] ?? `http://127.0.0.1:${runtimePort}/rpc`;
const runtimeCapabilities = createElectronRuntimeCapabilities();
logStartup("create runtime kernel");
const runtime = await createPlasticRuntime({ workspaceDir, eventPath, capabilities: runtimeCapabilities });
const { eventStore, methods, runPromise } = runtime;
logStartup("runtime kernel ready");
const codexAdapter = createCodexAdapter({
  eventStore,
  methods,
  runPromise,
  workspaceDir,
  runtimeRpcUrl: preferredRuntimeRpcUrl,
  runtimeRpcUrls
});

const buildStatus = () => ({
  service: "plastic.build",
  status: "running",
  workspaceDir,
  plasticDir,
  dataDir: runtimePaths.dataDir,
  extensionsDir: join(plasticDir, "extensions"),
  eventPath,
  viteUrl: process.env.VITE_DEV_SERVER_URL ?? null,
  runtimeSocket: `http://${runtimeHost}:${runtimePort}`,
  runtimeRpcUrl: preferredRuntimeRpcUrl,
  runtimeRpcUrls,
  buildSocket: `http://${buildHost}:${buildPort}`,
  pid: process.pid,
  startedAt: processStartedAt
});

const readGitStatus = async () => {
  const status = await runLocalCommand("git", ["status", "--short"]);
  return {
    ok: status.exitCode === 0,
    exitCode: status.exitCode,
    files: status.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => ({
        status: line.slice(0, 2),
        path: line.slice(3)
      })),
    stderr: status.stderr
  };
};

async function createWindow(title = "Plastic") {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title,
    webPreferences: {
      preload: new URL("../preload/preload.js", import.meta.url).pathname,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  windows.add(window);

  window.on("closed", () => {
    windows.delete(window);
    void runPromise(
      eventStore.append(
        createEvent({
          type: "window.closed",
          payload: { electronWindowId: window.id }
        })
      )
    );
  });

  await runPromise(
      eventStore.append(
        createEvent({
          type: "window.created",
          payload: { id: `electron:${window.id}`, electronWindowId: window.id, title }
        })
      )
  );

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(new URL("../../dist/index.html", import.meta.url).pathname);
  }

  return { id: `electron:${window.id}`, electronWindowId: window.id, title };
}

ipcMain.handle(ipcChannels.rpcCall, async (_event, request: RpcRequest): Promise<RpcResponse> => {
  try {
    const value = await runPromise(methods.call(request.method, request.input));
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

logStartup("ensure bundled extensions");
await discoverBundledExtensionsAtStartup({ workspaceDir, bundledExtensionsDir, eventStore, runPromise });
logStartup("ensure bundled panels");
await ensureBundledPanelsAtStartup({ workspaceDir, eventStore, runPromise });
logStartup("ensure panel renderer bindings");
await ensurePanelRendererBindingsAtStartup({ workspaceDir, eventStore, runPromise });
logStartup("register runtime methods");
const electronDeixisHost = createElectronDeixisHost(BrowserWindow);
const windowCapabilityModule = createWindowCapabilityModule({
  browserWindow: BrowserWindow,
  createWindow,
  scrollRefIntoViewScript: electronDeixisHost.scrollRefIntoViewScript
});
const deixisMethodModule = createDeixisMethodModule(electronDeixisHost);
const runtimeStateModule = createRuntimeStateModule({
  decorateState: (state) => ({
    ...state,
    app: { ...state.app, mode: "electron" },
    bus: {
      runtimeRpcUrl: preferredRuntimeRpcUrl,
      runtimeRpcUrls,
      runtimeHost,
      runtimePort
    },
    resources: [
      ...state.resources,
      {
        id: "rpc-bus",
        kind: "service",
        title: "Plastic RPC Bus",
        state: {
          runtimeRpcUrl: preferredRuntimeRpcUrl,
          runtimeRpcUrls,
          runtimeHost,
          runtimePort
        },
        links: [
          { rel: "rpc", href: preferredRuntimeRpcUrl, method: "http/post" },
          { rel: "state", href: "plastic/state", method: "plastic/state" },
          { rel: "methods", href: "plastic/methods", method: "plastic/methods" }
        ],
        actions: [
          { id: "call", title: "Call RPC method", method: "rpc/call" }
        ]
      }
    ]
  })
});
const runtimeSnapshotModule = createRuntimeSnapshotModule({
  getHostDetails: async () => ({
    app: {
      name: "Plastic",
      mode: "electron",
      version: app.getVersion(),
      ready: app.isReady(),
      workspaceDir,
      eventPath
    },
    build: buildStatus(),
    runtime: {
      windowCount: BrowserWindow.getAllWindows().length,
      retainedWindowCount: windows.size,
      eventStream: "runtime-http-transport"
    },
    codex: codexAdapter.status(),
    visibleRefs: await electronDeixisHost.listVisibleRefs()
  })
});
const agentWorkbenchModule = createAgentWorkbenchModule({
  mode: "electron",
  workspaceDir,
  eventPath,
  getRuntimeStatus: buildStatus,
  getCodexStatus: () => codexAdapter.status(),
  readGitStatus,
  getFocusedElectronWindowId: () => electronDeixisHost.findWindow()?.id,
  listVisibleRefs: electronDeixisHost.listVisibleRefs,
  panelIdFromRef: electronDeixisHost.panelIdFromRef,
  sourceHintsFor: electronDeixisHost.sourceHintsFor,
  visualActions: ({ ref, panelId }) => [
    { id: "list-refs", title: "List visible refs", method: "deixis/listVisibleRefs" },
    { id: "screenshot", title: "Capture screenshot", method: "windows/screenshot", input: ref ? { ref } : {} },
    ...(panelId ? [{ id: "focus-panel", title: "Focus panel", method: "windows/focusPanel", input: { panelId } }] : [])
  ]
});
const agentOrientModule = createAgentOrientModule({
  workspaceDir,
  findFocusedWindowId: (windowId) => electronDeixisHost.findWindow(windowId)?.id,
  listVisibleRefs: electronDeixisHost.listVisibleRefs
});
const runtimeBuildModule = createRuntimeBuildModule({
  getStatus: buildStatus,
  runCommand: runLocalCommand
});
const runtimeDiagnosticsModule = createRuntimeDiagnosticsModule({
  getDiagnostics: () => ({
    cwd: process.cwd(),
    workspaceDir,
    eventPath,
    appReady: app.isReady(),
    windowCount: BrowserWindow.getAllWindows().length,
    retainedWindowCount: windows.size,
    viteUrl: process.env.VITE_DEV_SERVER_URL ?? null
  })
});
const extensionAuthoringModule = createExtensionAuthoringModule({ plasticDir });
const rendererControlModule = createRendererControlModule({
  reloadRenderers: () =>
    BrowserWindow.getAllWindows().map((window) => {
      window.webContents.reload();
      return { windowId: window.id, reloaded: true };
    })
});
await runtime.registerModules(
  createRuntimeModulePlan({
    state: runtimeStateModule,
    snapshot: runtimeSnapshotModule,
    agentWorkbench: agentWorkbenchModule,
    agentOrient: agentOrientModule,
    build: runtimeBuildModule,
    diagnostics: runtimeDiagnosticsModule,
    extensionAuthoring: extensionAuthoringModule,
    rendererControl: rendererControlModule,
    agentBackend: null,
    windowCapability: windowCapabilityModule,
    deixis: deixisMethodModule,
    health: null
  }),
  (module) => logStartup(`register ${module.id} module`)
);
logStartup("register extension methods");
await registerExtensionMethods({ workspaceDir, eventStore, methods, runPromise });
logStartup("scan workspace extensions");
await discoverWorkspaceExtensionsAtStartup({ workspaceDir, eventStore, runPromise });
logStartup("activate extensions");
await activateExtensions({ workspaceDir, eventStore, methods, runPromise });
logStartup("register panel mailbox methods");
await runtime.registerModules(
  [panelMailboxModule],
  (module) => logStartup(`register ${module.id} module`)
);
logStartup("register codex methods");
await codexAdapter.registerMethods();
const runtimeHealthModule = createRuntimeHealthModule({
  description: "Runs a fast control-plane health check for event store, projections, methods, DOM refs, build status, and Codex status.",
  hostChecks: [
    { id: "deixis:listVisibleRefs", run: async () => ({ windows: (await electronDeixisHost.listVisibleRefs()).length }) },
    { id: "build:status", run: () => buildStatus() },
    { id: "codex:status", run: () => codexAdapter.status() },
    { id: "bridge:status", run: () => runPromise(methods.call("bridge/status", {})) }
  ]
});
await runtime.registerModules(
  [runtimeHealthModule],
  (module) => logStartup(`register ${module.id} module`)
);
await runPromise(
  eventStore.append(
    createEvent({
      type: "runtime.started",
      payload: {
        version: app.getVersion()
      }
    })
  )
);

logStartup("start sockets");
const runtimeTransport = await startRuntimeHttpTransport({
  eventStore,
  methods,
  runPromise,
  host: runtimeHost,
  port: runtimePort,
  corsOrigin: "http://127.0.0.1:5173"
});
const buildSocket = startBuildHttpTransport({
  methods,
  runPromise,
  host: buildHost,
  port: buildPort,
  getStatus: buildStatus
});
logStartup(`runtime listening on ${runtimePort}, build listening on ${buildPort}`);

app.on("ready", () => {
  void createWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  runtimeTransport.close();
  buildSocket.close();
});
