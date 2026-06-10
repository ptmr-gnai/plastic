import { createRequire } from "node:module";
import { spawn as spawnProcess } from "node:child_process";
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
import {
  prepareBundledExtensionStateAtStartup,
  registerAndActivateExtensionsAtStartup
} from "./extension-startup.js";
import { panelMailboxModule } from "./panel-methods.js";
import { createElectronRuntimeCapabilities } from "./runtime-capabilities.js";
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
import { createRuntimeHealthModule } from "./runtime-health-methods.js";
import { createPlasticRuntime } from "./runtime-kernel.js";
import { createRuntimeModulePlan } from "./runtime-module-plan.js";
import { createRuntimeSnapshotModule } from "./runtime-snapshot-methods.js";
import { createRuntimeStateModule } from "./runtime-state-methods.js";

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
await prepareBundledExtensionStateAtStartup({ workspaceDir, bundledExtensionsDir, eventStore, runPromise });
logStartup("register runtime methods");
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
const runtimeStateModule = createRuntimeStateModule({
  decorateState: (state) => decorateRuntimeState({
    state,
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
    }
  })
});
const runtimeSnapshotModule = createRuntimeSnapshotModule({
  getHostDetails: async () => ({
    app: createSnapshotAppDetails({
      config: hostConfig,
      mode: "electron",
      version: app.getVersion(),
      ready: app.isReady()
    }),
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
await runtime.registerModules(
  createRuntimeModulePlan({
    state: runtimeStateModule,
    snapshot: runtimeSnapshotModule,
    agentWorkbench: agentModules.agentWorkbench,
    agentOrient: agentModules.agentOrient,
    build: supportModules.build,
    diagnostics: supportModules.diagnostics,
    extensionAuthoring: supportModules.extensionAuthoring,
    rendererControl: capabilityModules.rendererControl,
    agentBackend: null,
    windowCapability: capabilityModules.windowCapability,
    deixis: capabilityModules.deixis,
    health: null
  }),
  (module) => logStartup(`register ${module.id} module`)
);
logStartup("register extension methods");
await registerAndActivateExtensionsAtStartup({ workspaceDir, eventStore, methods, runPromise });
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
const transports = await startRuntimeHostTransports({
  eventStore,
  methods,
  runPromise,
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
