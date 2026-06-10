import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawn as spawnProcess } from "node:child_process";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { BrowserWindow as ElectronBrowserWindow, Rectangle } from "electron";
import { Effect } from "effect";
import {
  buildTimeline,
  createEvent,
  eventSummary,
  isNoisyEvent,
  projectExtensions,
  projectPanels,
  projectWindows,
  type EventScopeInput,
  type EventStore,
  type PlasticEvent,
  type TimelineInput
} from "@plastic/core";
import { ipcChannels, type RpcRequest, type RpcResponse } from "../shared/ipc.js";
import { createAgentWorkbenchModule } from "./agent-workbench-methods.js";
import { createCodexAdapter } from "./codex-adapter.js";
import { createDeixisMethodModule } from "./deixis-methods.js";
import type { RefInput, ScreenshotInput, VerifyRefActionInput, VisibleRef, WindowVisibleRefs } from "./deixis-types.js";
import { createElectronWindowModule } from "./electron-window-methods.js";
import { createExtensionAuthoringModule } from "./extension-authoring-methods.js";
import { activateExtensions } from "./extension-host.js";
import { registerExtensionMethods, scanBundledExtensions, scanWorkspaceExtensions } from "./extension-loader.js";
import { panelControlModule } from "./panel-control-methods.js";
import { panelMailboxModule } from "./panel-methods.js";
import { readJsonBody, sendJson, startRuntimeHttpTransport } from "./runtime-http-transport.js";
import { createRuntimeBuildModule } from "./runtime-build-methods.js";
import { runtimeControlModule } from "./runtime-control-methods.js";
import { createRuntimeDiagnosticsModule } from "./runtime-diagnostics-methods.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";
import { createPlasticRuntime } from "./runtime-kernel.js";
import { createRuntimeSnapshotModule } from "./runtime-snapshot-methods.js";
import { createRuntimeStateModule } from "./runtime-state-methods.js";
import { resolvePlasticRuntimePaths } from "./runtime-paths.js";

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
const runtimeCapabilities = [
  { id: "runtime.capabilities", title: "Runtime capability registry", status: "available" as const },
  { id: "window.projection", title: "Window projection", status: "available" as const },
  { id: "electron.window", title: "Electron windows", status: "available" as const },
  { id: "dom.refs", title: "DOM visible refs", status: "available" as const },
  { id: "dom.eval", title: "DOM evaluation", status: "available" as const },
  { id: "dom.input", title: "DOM input control", status: "available" as const },
  { id: "screenshot", title: "Window screenshot capture", status: "available" as const },
  { id: "event.projection", title: "Event projection", status: "available" as const }
];
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

type AgentOrientInput = {
  agentId?: string;
  panelId?: string;
  windowId?: number | string;
  eventCursor?: string;
};

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

const listVisibleRefs = async (): Promise<WindowVisibleRefs[]> => {
  const refs = [];
  for (const window of BrowserWindow.getAllWindows()) {
    const windowRefs = await window.webContents.executeJavaScript(`
      [...document.querySelectorAll("[data-plastic-ref]")].map((element) => ({
        ref: element.dataset.plasticRef,
        panel: element.dataset.plasticPanel,
        extension: element.dataset.plasticExtension,
        command: element.dataset.plasticCommand,
        tag: element.tagName.toLowerCase(),
        text: (element.innerText || element.textContent || "").slice(0, 240),
        bounds: (() => {
          const rect = element.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
        })()
      }))
    `) as VisibleRef[];
    refs.push({ windowId: window.id, refs: windowRefs });
  }
  return refs;
};

const scrollRefIntoViewScript = (ref: string) => `
  (() => {
    const ref = ${JSON.stringify(ref)};
    const element = [...document.querySelectorAll("[data-plastic-ref]")]
      .find((candidate) => candidate.dataset.plasticRef === ref);
    if (!element) {
      return false;
    }
    const rail = document.querySelector(".rail");
    if (rail && rail.contains(element)) {
      const railRect = rail.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      rail.scrollLeft += rect.left - railRect.left - Math.max(0, (rail.clientWidth - rect.width) / 2);
      rail.scrollTop += rect.top - railRect.top - Math.max(0, (rail.clientHeight - rect.height) / 2);
    } else {
      element.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
    }
    return true;
  })()
`;

const findWindow = (windowId?: number) => {
  if (windowId !== undefined) {
    return BrowserWindow.getAllWindows().find((window) => window.id === windowId) ?? null;
  }
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
};

const captureWindow = async (input: ScreenshotInput = {}) => {
  const target = findWindow(input.windowId);
  if (!target) {
    throw new Error("No window available");
  }

  let rect: Rectangle | undefined;
  if (input.ref) {
    const measured = await target.webContents.executeJavaScript(`
      (async () => {
        const ref = ${JSON.stringify(input.ref)};
        const element = [...document.querySelectorAll("[data-plastic-ref]")]
          .find((candidate) => candidate.dataset.plasticRef === ref);
        if (!element) {
          return null;
        }
        ${scrollRefIntoViewScript(input.ref)}
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const rect = element.getBoundingClientRect();
        return {
          x: Math.max(0, Math.floor(rect.x)),
          y: Math.max(0, Math.floor(rect.y)),
          width: Math.max(1, Math.ceil(rect.width)),
          height: Math.max(1, Math.ceil(rect.height))
        };
      })()
    `) as Rectangle | null;
    if (!measured) {
      throw new Error(`No visible element for ref ${input.ref}`);
    }
    rect = measured;
  }

  const image = await target.webContents.capturePage(rect);
  const size = image.getSize();
  return {
    windowId: target.id,
    ref: input.ref ?? null,
    width: size.width,
    height: size.height,
    dataUrl: image.toDataURL()
  };
};

const findRecentEvents = (events: PlasticEvent[], predicate: (event: PlasticEvent) => boolean, limit = 20) =>
  events.filter(predicate).slice(-limit);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const sourceHintsFor = (input: { ref?: string; panelId?: string; extensionId?: string; command?: string }) => {
  const hints = new Set<string>();
  if (input.ref?.startsWith("panel:") || input.panelId) {
    hints.add("apps/desktop/src/renderer/main.ts");
    hints.add("apps/desktop/src/renderer/styles.css");
    hints.add("packages/core/src/panels.ts");
  }
  if (input.ref?.startsWith("panel-button:") || input.command?.startsWith("chats/")) {
    hints.add("apps/desktop/src/main/main.ts");
    hints.add("apps/desktop/src/main/codex-adapter.ts");
    hints.add("apps/desktop/src/renderer/main.ts");
  }
  if (input.extensionId?.startsWith("workspace.")) {
    hints.add("apps/desktop/src/main/extension-loader.ts");
    hints.add(".plastic/extensions");
  }
  if (input.command?.startsWith("codex/")) {
    hints.add("apps/desktop/src/main/codex-adapter.ts");
    hints.add("docs/CODEX_APP_SERVER_INTEGRATION.md");
  }
  if (input.command?.startsWith("panels/")) {
    hints.add("packages/core/src/panels.ts");
    hints.add("apps/desktop/src/main/main.ts");
  }
  return [...hints];
};

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

const resolveVisibleRef = async (ref: string) => {
  const visibleRefs = await listVisibleRefs();
  for (const windowRefs of visibleRefs) {
    const match = windowRefs.refs.find((candidate) => candidate.ref === ref);
    if (match) {
      return { windowId: windowRefs.windowId, ref: match };
    }
  }
  return null;
};

const panelIdFromRef = (ref: string) => {
  if (ref.startsWith("message:")) {
    return ref.split(":")[1];
  }
  for (const prefix of ["panel:", "chat-compose:", "chat-shell:", "chat-status:", "chat-buttons:", "chat-log:"]) {
    if (ref.startsWith(prefix)) {
      return ref.slice(prefix.length);
    }
  }
  const messageMatch = ref.match(/^message-([^-]+-.+)-\d+$/);
  return messageMatch?.[1];
};

const ensureBundledExtensions = async (store: EventStore) => {
  const events = await runPromise(store.list());
  const bundledExtensions = await scanBundledExtensions(workspaceDir, bundledExtensionsDir);
  for (const extension of bundledExtensions) {
    const latestManifest = events
      .filter((event) => event.type === "extension.discovered" && event.scope.extensionId === extension.id)
      .map((event) => (event.payload as { manifest?: unknown }).manifest)
      .at(-1);
    if (JSON.stringify(latestManifest) === JSON.stringify(extension)) {
      continue;
    }

    await runPromise(
      store.append(
        createEvent({
          type: "extension.discovered",
          payload: {
            id: extension.id,
            title: extension.title,
            source: "bundled",
            path: extension.path,
            entry: extension.entry,
            manifestPath: extension.manifestPath,
            manifest: extension,
            errors: extension.errors
          },
          scope: { extensionId: extension.id },
          meta: {
            links: [
              { rel: "self", href: "extensions/get", method: "extensions/get", target: extension.id },
              { rel: "extensions", href: "extensions/list", method: "extensions/list" }
            ]
          }
        })
      )
    );
  }
};

const ensureBundledPanels = async (store: EventStore) => {
  const events = await runPromise(store.list());
  const extensions = projectExtensions(events);
  const existingPanelIds = new Set(projectPanels(events).map((panel) => panel.id));
  const introducedPanelIds = new Set(
    events
      .filter((event) => event.type === "panel.created")
      .map((event) => {
        const payload = event.payload as { id?: string };
        return payload.id ?? event.scope.panelId;
      })
      .filter((id): id is string => Boolean(id))
  );

  for (const extension of extensions.filter((candidate) => candidate.source === "bundled")) {
    for (const panel of extension.panels) {
      if (existingPanelIds.has(panel.id) || introducedPanelIds.has(panel.id)) {
        continue;
      }

      await runPromise(
        store.append(
          createEvent({
            type: "panel.created",
            payload: {
              ...panel,
              extensionId: extension.id
            },
            scope: {
              panelId: panel.id,
              extensionId: extension.id
            },
            meta: {
              links: [
                { rel: "panel", href: "panels/get", method: "panels/get", target: panel.id },
                { rel: "extension", href: "extensions/get", method: "extensions/get", target: extension.id }
              ]
            }
          })
        )
      );
    }
  }
};

const ensurePanelRendererBindings = async (store: EventStore) => {
  const events = await runPromise(store.list());
  const extensions = projectExtensions(events);
  const panels = projectPanels(events);

  for (const panel of panels) {
    if (panel.rendererId) {
      continue;
    }

    const extension = extensions.find((candidate) => candidate.id === panel.extensionId);
    const renderer = extension?.renderers.find((candidate) => candidate.panelKinds.includes(panel.kind))
      ?? extension?.renderers[0];
    if (!renderer) {
      continue;
    }

    await runPromise(
      store.append(
        createEvent({
          type: "panel.renderer.bound",
          payload: {
            id: panel.id,
            extensionId: panel.extensionId,
            rendererId: renderer.id,
            reason: "matched extension renderer contribution"
          },
          scope: {
            panelId: panel.id,
            extensionId: panel.extensionId
          },
          meta: {
            links: [
              { rel: "panel", href: "panels/get", method: "panels/get", target: panel.id },
              { rel: "extension", href: "extensions/get", method: "extensions/get", target: panel.extensionId }
            ]
          }
        })
      )
    );
  }
};

const registerRuntimeMethods = async (store: EventStore) => {
  await runPromise(
    methods.register({
      id: "agent/orient",
      title: "Orient agent",
      description: "Returns a compact local orientation packet for an embodied agent or panel.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const orientInput = input as AgentOrientInput | undefined;
          const events = await runPromise(store.list());
          const panels = projectPanels(events);
          const windowsModel = projectWindows(events);
          const visibleRefWindows = await listVisibleRefs().catch(() => []);
          const methodList = await runPromise(methods.list());

          const panelId = orientInput?.panelId ?? orientInput?.agentId;
          const currentPanel = panelId ? panels.find((panel) => panel.id === panelId) : undefined;
          const focusedWindow = findWindow(typeof orientInput?.windowId === "number" ? orientInput.windowId : undefined);
          const modelWindow = panelId
            ? windowsModel.find((window) => window.panelIds.includes(panelId))
            : windowsModel.find((window) => window.electronWindowId === focusedWindow?.id) ?? windowsModel[0];
          const electronWindowId = typeof orientInput?.windowId === "number"
            ? orientInput.windowId
            : modelWindow?.electronWindowId ?? focusedWindow?.id;
          const visibleRefs = visibleRefWindows
            .filter((windowRefs) => electronWindowId === undefined || windowRefs.windowId === electronWindowId)
            .flatMap((windowRefs) => windowRefs.refs.map((ref) => ({ windowId: windowRefs.windowId, ...ref })));
          const localVisibleRefs = panelId
            ? visibleRefs.filter((ref) => ref.panel === panelId || ref.ref?.includes(panelId))
            : visibleRefs;
          const orderedPanels = [...panels].sort((left, right) => left.order - right.order);
          const currentIndex = currentPanel ? orderedPanels.findIndex((panel) => panel.id === currentPanel.id) : -1;
          const neighboringPanels = currentIndex >= 0
            ? orderedPanels.slice(Math.max(0, currentIndex - 2), currentIndex + 3).filter((panel) => panel.id !== currentPanel?.id)
            : orderedPanels.slice(0, 5);
          const recommendedMethodIds = [
            "agent/orient",
            "plastic/state",
            "events/timeline",
            "plastic/methods",
            "chats/sendToCodex",
            "chats/createCodexChat",
            "deixis/listVisibleRefs",
            "deixis/resolveRef",
            "deixis/fillRef",
            "deixis/clickRef",
            "windows/screenshot"
          ];
          const recommendedMethods = methodList
            .filter((method) => recommendedMethodIds.includes(method.id))
            .map((method) => ({
              id: method.id,
              title: method.title,
              description: method.description,
              owner: method.owner
            }));
          const binding = panelId && methodList.some((method) => method.id === "chats/getBinding")
            ? await runPromise(methods.call("chats/getBinding", { chatId: panelId })).catch((error) => ({
              error: error instanceof Error ? error.message : String(error)
            }))
            : null;
          const timelineInput: TimelineInput = { limit: 20 };
          if (orientInput?.eventCursor) {
            timelineInput.after = orientInput.eventCursor;
          }
          if (panelId) {
            timelineInput.scope = { panelId };
          }
          const timeline = buildTimeline(events, timelineInput);
          const globalTimeline = timeline.items.length > 0
            ? timeline
            : buildTimeline(events, orientInput?.eventCursor ? { after: orientInput.eventCursor, limit: 20 } : { limit: 20 });
          const agentId = orientInput?.agentId ?? (panelId ? `agent:${panelId}` : "agent:unknown");

          return {
            agent: {
              id: agentId,
              name: currentPanel?.title ? `${currentPanel.title} agent` : "Plastic agent",
              runtime: currentPanel?.kind === "chat" ? "codex" : "plastic",
              role: "embodied workspace collaborator"
            },
            embodiment: {
              panelId: panelId ?? null,
              threadId: asString(asRecord(binding).threadId) ?? null,
              windowId: modelWindow?.id ?? (electronWindowId ? `electron:${electronWindowId}` : null),
              electronWindowId: electronWindowId ?? null,
              projectDir: workspaceDir,
              backend: currentPanel?.kind === "chat" ? "codex" : null,
              binding
            },
            visibleContext: {
              focusedPanelId: panelId ?? currentPanel?.id ?? null,
              currentPanel: currentPanel ?? null,
              neighboringPanels,
              visibleRefs: localVisibleRefs.slice(0, 40)
            },
            memory: {
              latestEventId: events.at(-1)?.id ?? null,
              eventCount: events.length,
              eventCursor: events.at(-1)?.id ?? null,
              sinceCursor: globalTimeline.items,
              recentUserIntents: globalTimeline.items.filter((item) => item.type.includes("user_message")).slice(-8),
              recentAgentActions: globalTimeline.items.filter((item) =>
                item.actor.kind === "agent" ||
                item.type.startsWith("bridge.") ||
                item.type.startsWith("codex.") ||
                item.type.includes("agent_message")
              ).slice(-12)
            },
            capabilities: {
              methods: recommendedMethods,
              recommendedActions: [
                { id: "refresh-orientation", title: "Refresh orientation", method: "agent/orient", input: { panelId, eventCursor: events.at(-1)?.id } },
                { id: "read-state", title: "Read full Plastic state", method: "plastic/state" },
                { id: "read-timeline", title: "Read recent timeline", method: "events/timeline", input: { after: events.at(-1)?.id } },
                ...(panelId ? [{ id: "send-chat", title: "Send a message through this chat", method: "chats/sendToCodex", input: { chatId: panelId } }] : []),
                { id: "inspect-visible-refs", title: "Inspect visible refs", method: "deixis/listVisibleRefs" },
                { id: "capture-screenshot", title: "Capture screenshot", method: "windows/screenshot" }
              ],
              links: [
                { rel: "self", href: "agent/orient", method: "agent/orient" },
                { rel: "state", href: "plastic/state", method: "plastic/state" },
                { rel: "timeline", href: "events/timeline", method: "events/timeline" },
                { rel: "methods", href: "plastic/methods", method: "plastic/methods" },
                { rel: "visible-refs", href: "deixis/listVisibleRefs", method: "deixis/listVisibleRefs" }
              ]
            },
            obligations: {
              orientBeforeMutation: true,
              verifyAfterMutation: true,
              durableEventsRequired: true,
              callPlasticStateBeforeGuessingIds: true
            }
          };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "renderer/reload",
      title: "Reload renderer",
      description: "Reloads all Electron renderer windows.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () =>
        Effect.sync(() => {
          const result = BrowserWindow.getAllWindows().map((window) => {
            window.webContents.reload();
            return { windowId: window.id, reloaded: true };
          });
          return result;
        })
    })
  );

};

const startBuildSocket = () => {
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { ok: true, service: "plastic.build" });
      return;
    }

    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, {
        ok: true,
        value: buildStatus()
      });
      return;
    }

    if (request.method === "GET" && request.url === "/snapshot") {
      try {
        sendJson(response, 200, { ok: true, value: await runPromise(methods.call("plastic/snapshot", {})) });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/rpc") {
      try {
        const body = await readJsonBody(request) as RpcRequest;
        const value = await runPromise(methods.call(body.method, body.input));
        sendJson(response, 200, { ok: true, value });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  });

  server.listen(buildPort, buildHost);
  return server;
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
await ensureBundledExtensions(eventStore);
logStartup("ensure bundled panels");
await ensureBundledPanels(eventStore);
logStartup("ensure panel renderer bindings");
await ensurePanelRendererBindings(eventStore);
logStartup("register runtime methods");
await registerRuntimeMethods(eventStore);
const electronWindowModule = createElectronWindowModule({
  browserWindow: BrowserWindow,
  createWindow,
  scrollRefIntoViewScript
});
const deixisMethodModule = createDeixisMethodModule({
  captureWindow,
  findWindow,
  listVisibleRefs,
  panelIdFromRef,
  resolveVisibleRef,
  scrollRefIntoViewScript,
  sourceHintsFor
});
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
    visibleRefs: await listVisibleRefs()
  })
});
const agentWorkbenchModule = createAgentWorkbenchModule({
  mode: "electron",
  workspaceDir,
  eventPath,
  getRuntimeStatus: buildStatus,
  getCodexStatus: () => codexAdapter.status(),
  readGitStatus,
  getFocusedElectronWindowId: () => findWindow()?.id,
  listVisibleRefs,
  panelIdFromRef,
  sourceHintsFor,
  visualActions: ({ ref, panelId }) => [
    { id: "list-refs", title: "List visible refs", method: "deixis/listVisibleRefs" },
    { id: "screenshot", title: "Capture screenshot", method: "windows/screenshot", input: ref ? { ref } : {} },
    ...(panelId ? [{ id: "focus-panel", title: "Focus panel", method: "windows/focusPanel", input: { panelId } }] : [])
  ]
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
await runtime.registerModules(
  [
    runtimeStateModule,
    runtimeSnapshotModule,
    agentWorkbenchModule,
    runtimeBuildModule,
    runtimeDiagnosticsModule,
    extensionAuthoringModule,
    runtimeControlModule,
    panelControlModule,
    electronWindowModule,
    deixisMethodModule
  ],
  (module) => logStartup(`register ${module.id} module`)
);
logStartup("register extension methods");
await registerExtensionMethods({ workspaceDir, eventStore, methods, runPromise });
logStartup("scan workspace extensions");
const discoveredExtensions = await scanWorkspaceExtensions(workspaceDir);
for (const extension of discoveredExtensions) {
  await runPromise(
    eventStore.append(
      createEvent({
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
      })
    )
  );
}
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
    { id: "deixis:listVisibleRefs", run: async () => ({ windows: (await listVisibleRefs()).length }) },
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
const buildSocket = startBuildSocket();
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
