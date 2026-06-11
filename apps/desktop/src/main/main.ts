import { createRequire } from "node:module";
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
import { createCodexAdapter } from "./codex-adapter.js";
import { createElectronDeixisHost } from "./electron-deixis-host.js";
import { createElectronRuntimeCapabilities } from "./runtime-capabilities.js";
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
import type { RuntimeModule } from "./runtime-method-context.js";

const require = createRequire(import.meta.url);
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, ipcMain } = electron;
const hostConfig = createRuntimeHostConfig();
const {
  workspaceDir,
  plasticDir,
  bundledExtensionsDir,
  eventPath,
  runtimeHost,
  runtimePort,
  buildHost,
  buildPort,
  runtimeRpcUrls,
  preferredRuntimeRpcUrl
} = hostConfig;

const logStartup = (stage: string) => {
  console.log(`[plastic:startup] ${stage}`);
};

const runLocalCommand = createWorkspaceCommandRunner(workspaceDir);

const windows = new Set<ElectronBrowserWindow>();
const processStartedAt = new Date().toISOString();
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

const buildStatus = () => createRuntimeBuildStatus({
  config: hostConfig,
  service: "plastic.build",
  startedAt: processStartedAt,
  runtimeRpcUrl: preferredRuntimeRpcUrl,
  extensionsDir: join(plasticDir, "extensions"),
  viteUrl: process.env.VITE_DEV_SERVER_URL ?? null,
  runtimeSocket: `http://${runtimeHost}:${runtimePort}`,
  runtimeRpcUrls
});

const readGitStatus = createGitStatusReader({ runCommand: runLocalCommand });

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

const electronDeixisHost = createElectronDeixisHost(BrowserWindow);
const capabilityModules = createRuntimeHostCapabilityModules({
  rendererControl: {
    reloadRenderers: () =>
      BrowserWindow.getAllWindows().map((window) => {
        window.webContents.reload();
        return { windowId: window.id, reloaded: true };
      })
  },
  windowCapability: {
    browserWindow: BrowserWindow,
    createWindow,
    scrollRefIntoViewScript: electronDeixisHost.scrollRefIntoViewScript
  },
  deixis: electronDeixisHost
});
const projectionModules = createRuntimeHostProjectionModules({
  config: hostConfig,
  mode: "electron",
  bus: {
    runtimeRpcUrl: preferredRuntimeRpcUrl,
    runtimeRpcUrls,
    runtimeHost,
    runtimePort
  },
  resource: {
    id: "rpc-bus",
    title: "Plastic RPC Bus",
    state: {
      runtimeRpcUrl: preferredRuntimeRpcUrl,
      runtimeRpcUrls,
      runtimeHost,
      runtimePort
    },
    rpcUrl: preferredRuntimeRpcUrl
  },
  getHostDetails: async () => ({
    app: { version: app.getVersion(), ready: app.isReady() },
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
const agentModules = createRuntimeHostAgentModules({
  workbench: {
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
  },
  orient: {
    workspaceDir,
    findFocusedWindowId: (windowId) => electronDeixisHost.findWindow(windowId)?.id,
    listVisibleRefs: electronDeixisHost.listVisibleRefs
  }
});
const supportModules = createRuntimeHostSupportModules({
  plasticDir,
  getBuildStatus: buildStatus,
  runCommand: runLocalCommand,
  getDiagnostics: () => createRuntimeDiagnostics({
    config: hostConfig,
    appReady: app.isReady(),
    windowCount: BrowserWindow.getAllWindows().length,
    retainedWindowCount: windows.size,
    viteUrl: process.env.VITE_DEV_SERVER_URL ?? null
  })
});
const runtimeHealthModule = createRuntimeHealthModule({
  description: "Runs a fast control-plane health check for event store, projections, methods, DOM refs, build status, and Codex status.",
  hostChecks: [
    { id: "deixis:listVisibleRefs", run: async () => ({ windows: (await electronDeixisHost.listVisibleRefs()).length }) },
    { id: "build:status", run: () => buildStatus() },
    { id: "codex:status", run: () => codexAdapter.status() },
    { id: "bridge:status", run: () => runPromise(methods.call("bridge/status", {})) }
  ]
});
const codexAgentBackendModule: RuntimeModule = {
  id: "agent-backend-codex",
  register: async () => {
    await codexAdapter.registerMethods();
  }
};
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
  agentBackend: codexAgentBackendModule,
  windowCapability: capabilityModules.windowCapability,
  deixis: capabilityModules.deixis,
  health: runtimeHealthModule,
  onRegister: (module) => logStartup(`register ${module.id} module`),
  onPhase: logStartup,
  startedPayload: {
    mode: "electron",
    version: app.getVersion()
  },
  onBeforeTransports: () => logStartup("start sockets"),
  runtimeHost,
  runtimePort,
  buildHost,
  buildPort,
  getBuildStatus: buildStatus,
  runtimeCorsOrigin: "http://127.0.0.1:5173"
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
  transports.close();
});
