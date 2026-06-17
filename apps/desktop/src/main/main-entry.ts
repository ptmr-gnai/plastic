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
import { createCodexAdapter } from "./codex-adapter.js";
import { startElectronIpcTransport } from "./electron-ipc-transport.js";
import { createElectronDeixisHost } from "./electron-deixis-host.js";
import { createElectronRuntimeCapabilities } from "./runtime-capabilities.js";
import { createRuntimeHostBase } from "./runtime-host-base.js";
import { createElectronRuntimeHostStandardModules } from "./runtime-host-modules.js";
import { startRuntimeHostControlPlane } from "./runtime-host-control-plane.js";
import type { RuntimeModule } from "./runtime-method-context.js";

const require = createRequire(import.meta.url);
const electron = require("electron") as typeof import("electron");
const { app, BrowserWindow, ipcMain } = electron;
const windows = new Set<ElectronBrowserWindow>();
const {
  hostConfig,
  hostStatus,
  readGitStatus,
  runLocalCommand,
  runtime,
  startedPayload
} = await createRuntimeHostBase({
  capabilities: createElectronRuntimeCapabilities(),
  mode: "electron",
  service: "plastic.build",
  runtimeRpcUrl: (config) => config.preferredRuntimeRpcUrl,
  getBuildStatusExtra: (config) => ({
    extensionsDir: join(config.plasticDir, "extensions"),
    viteUrl: process.env.VITE_DEV_SERVER_URL ?? null,
    runtimeSocket: config.controlPlane.runtime.baseUrl,
    runtimeRpcUrls: config.runtimeRpcUrls
  }),
  getDiagnosticsExtra: () => ({
    appReady: app.isReady(),
    windowCount: BrowserWindow.getAllWindows().length,
    retainedWindowCount: windows.size,
    viteUrl: process.env.VITE_DEV_SERVER_URL ?? null
  })
});
const {
  workspaceDir,
  plasticDir,
  bundledExtensionsDir,
  eventPath,
  runtimePort,
  runtimeRpcUrls,
  preferredRuntimeRpcUrl,
  controlPlane
} = hostConfig;

const logStartup = (stage: string) => {
  console.log(`[plastic:startup] ${stage}`);
};

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

const buildStatus = hostStatus.buildStatus;

async function createWindow(title = "Plastic") {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title,
    webPreferences: {
      preload: new URL("../preload/preload.cjs", import.meta.url).pathname,
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

const electronIpcTransport = startElectronIpcTransport({ ipcMain, methods, runPromise });

const electronDeixisHost = createElectronDeixisHost(BrowserWindow);
const viteRuntimeCorsOrigin = process.env.VITE_DEV_SERVER_URL
  ? new URL(process.env.VITE_DEV_SERVER_URL).origin
  : "http://127.0.0.1:5173";
const codexAgentBackendModule: RuntimeModule = {
  id: "agent-backend",
  register: async () => {
    await codexAdapter.registerMethods();
  }
};
const startupModules = createElectronRuntimeHostStandardModules({
  config: hostConfig,
  workspaceDir,
  eventPath,
  plasticDir,
  getBuildStatus: buildStatus,
  getHost: hostStatus.host,
  runCommand: runLocalCommand,
  getDiagnostics: hostStatus.diagnostics,
  readGitStatus,
  getAppVersion: () => app.getVersion(),
  isAppReady: () => app.isReady(),
  getWindowCount: () => BrowserWindow.getAllWindows().length,
  getRetainedWindowCount: () => windows.size,
  getCodexStatus: () => codexAdapter.status(),
  callBridgeStatus: () => runPromise(methods.call("bridge/status", {})),
  findFocusedWindowId: (windowId) => electronDeixisHost.findWindow(windowId)?.id,
  listVisibleRefs: electronDeixisHost.listVisibleRefs,
  panelIdFromRef: electronDeixisHost.panelIdFromRef,
  sourceHintsFor: electronDeixisHost.sourceHintsFor,
  reloadRenderers: () =>
    BrowserWindow.getAllWindows().map((window) => {
      window.webContents.reload();
      return { windowId: window.id, reloaded: true };
    }),
  browserWindow: BrowserWindow,
  createWindow,
  scrollRefIntoViewScript: electronDeixisHost.scrollRefIntoViewScript,
  deixis: electronDeixisHost,
  agentBackend: codexAgentBackendModule
});
const transports = await startRuntimeHostControlPlane({
  workspaceDir,
  bundledExtensionsDir,
  eventStore,
  methods,
  runPromise,
  runtime,
  ...startupModules,
  onRegister: (module) => logStartup(`register ${module.id} module`),
  onPhase: logStartup,
  startedPayload: startedPayload({ version: app.getVersion() }),
  controlPlane,
  getBuildStatus: buildStatus,
  runtimeCorsOrigin: viteRuntimeCorsOrigin
});
logStartup(`runtime listening on ${controlPlane.runtime.port}, build listening on ${controlPlane.build.port}`);

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
  electronIpcTransport.close();
  transports.close();
});
