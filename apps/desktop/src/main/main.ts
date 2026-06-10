import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn as spawnProcess } from "node:child_process";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { BrowserWindow as ElectronBrowserWindow, Rectangle } from "electron";
import { Effect } from "effect";
import {
  buildTimeline,
  createEvent,
  buildPlasticState,
  eventSummary,
  groupMethodsByOwner,
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
import { createCodexAdapter } from "./codex-adapter.js";
import { createDeixisMethodModule } from "./deixis-methods.js";
import type { RefInput, ScreenshotInput, VerifyRefActionInput, VisibleRef, WindowVisibleRefs } from "./deixis-types.js";
import { createElectronWindowModule } from "./electron-window-methods.js";
import { activateExtensions } from "./extension-host.js";
import { registerExtensionMethods, scanBundledExtensions, scanWorkspaceExtensions } from "./extension-loader.js";
import { panelControlModule } from "./panel-control-methods.js";
import { panelMailboxModule } from "./panel-methods.js";
import { readJsonBody, sendJson, startRuntimeHttpTransport } from "./runtime-http-transport.js";
import { runtimeControlModule } from "./runtime-control-methods.js";
import { createPlasticRuntime } from "./runtime-kernel.js";
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

type AgentWorkbenchInput = {
  panelId?: string;
  ref?: string;
  eventCursor?: string;
  limit?: number;
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

const buildSnapshot = async () => {
  const events = await runPromise(eventStore.list());
  const registeredMethods = await runPromise(methods.list());
  const panels = projectPanels(events);
  const windowsModel = projectWindows(events, panels);
  const extensions = projectExtensions(events);
  const visibleRefs = await listVisibleRefs();

  return {
    app: {
      name: "Plastic",
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
    methods: {
      count: registeredMethods.length,
      items: registeredMethods.map((method) => ({
        id: method.id,
        title: method.title,
        owner: method.owner,
        description: method.description,
        links: method.links ?? []
      }))
    },
    panels,
    windows: windowsModel,
    extensions,
    visibleRefs,
    events: {
      count: events.length,
      latest: events.at(-1) ?? null,
      recent: events.slice(-30)
    },
    links: [
      { rel: "state", href: "plastic/state", method: "plastic/state" },
      { rel: "methods", href: "plastic/methods", method: "plastic/methods" },
      { rel: "events", href: "events/list", method: "events/list" },
      { rel: "visible-refs", href: "deixis/listVisibleRefs", method: "deixis/listVisibleRefs" },
      { rel: "self-test", href: "plastic/selfTest", method: "plastic/selfTest" }
    ]
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
      id: "plastic/state",
      title: "Plastic state",
      description: "Returns HATEOAS-style app state.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () =>
        Effect.map(buildPlasticState(store, methods), (state) => ({
          ...state,
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
        }))
    })
  );

  await runPromise(
    methods.register({
      id: "plastic/snapshot",
      title: "Plastic snapshot",
      description: "Returns a high-signal observable snapshot for agents: app, build, methods, panels, windows, extensions, visible refs, Codex, and recent events.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => Effect.promise(buildSnapshot)
    })
  );

  await runPromise(
    methods.register({
      id: "plastic/selfTest",
      title: "Plastic self-test",
      description: "Runs a fast control-plane health check for event store, projections, methods, DOM refs, build status, and Codex status.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () =>
        Effect.promise(async () => {
          const checks: Array<{ id: string; ok: boolean; details?: unknown }> = [];
          const record = (id: string, fn: () => Promise<unknown> | unknown) =>
            Promise.resolve()
              .then(fn)
              .then((details) => checks.push({ id, ok: true, details }))
              .catch((error) => checks.push({ id, ok: false, details: error instanceof Error ? error.message : String(error) }));

          await record("event-store:list", async () => ({ count: (await runPromise(store.list())).length }));
          await record("methods:list", async () => ({ count: (await runPromise(methods.list())).length }));
          await record("panels:project", async () => ({ count: projectPanels(await runPromise(store.list())).length }));
          await record("windows:project", async () => ({ count: projectWindows(await runPromise(store.list())).length }));
          await record("extensions:project", async () => ({ count: projectExtensions(await runPromise(store.list())).length }));
          await record("deixis:listVisibleRefs", async () => ({ windows: (await listVisibleRefs()).length }));
          await record("build:status", () => buildStatus());
          await record("codex:status", () => codexAdapter.status());
          await record("bridge:status", () => runPromise(methods.call("bridge/status", {})));

          const ok = checks.every((check) => check.ok);
          const event = await runPromise(
            store.append(
              createEvent({
                type: "plastic.self_test.completed",
                payload: { ok, checks }
              })
            )
          );
          return { ok, checks, eventId: event.id };
        })
    })
  );

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
      id: "agent/workbench",
      title: "Agent workbench",
      description: "Returns a high-signal workbench packet for agents: state, refs, events, methods, git dirt, and recommended actions.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const workbenchInput = input as AgentWorkbenchInput | undefined;
          const events = await runPromise(store.list());
          const methodList = await runPromise(methods.list());
          const panels = projectPanels(events);
          const extensions = projectExtensions(events);
          const windowsModel = projectWindows(events, panels);
          const focusedWindow = findWindow();
          const visibleRefWindows = await listVisibleRefs().catch(() => []);
          const visibleRefs = visibleRefWindows.flatMap((windowRefs) =>
            windowRefs.refs.map((ref) => ({ windowId: windowRefs.windowId, ...ref }))
          );
          const panelId = workbenchInput?.panelId ?? (workbenchInput?.ref ? panelIdFromRef(workbenchInput.ref) : undefined);
          const panel = panelId ? panels.find((candidate) => candidate.id === panelId) : undefined;
          const extension = panel?.extensionId ? extensions.find((candidate) => candidate.id === panel.extensionId) : undefined;
          const panelRefs = panelId
            ? visibleRefs.filter((ref) => ref.panel === panelId || ref.ref?.includes(panelId))
            : visibleRefs;
          const timelineInput: TimelineInput = {
            limit: workbenchInput?.limit ?? 25,
            ...(workbenchInput?.eventCursor ? { after: workbenchInput.eventCursor } : {}),
            ...(panelId ? { scope: { panelId } } : {})
          };
          const scopedTimeline = buildTimeline(events, timelineInput);
          const timeline = scopedTimeline.items.length > 0
            ? scopedTimeline
            : buildTimeline(events, {
              limit: workbenchInput?.limit ?? 25,
              ...(workbenchInput?.eventCursor ? { after: workbenchInput.eventCursor } : {})
            });
          const sourceHintInput: { ref?: string; panelId?: string; extensionId?: string; command?: string } = {};
          if (workbenchInput?.ref) {
            sourceHintInput.ref = workbenchInput.ref;
            const visibleRef = visibleRefs.find((ref) => ref.ref === workbenchInput.ref);
            if (visibleRef?.command) {
              sourceHintInput.command = visibleRef.command;
            }
          }
          if (panelId) {
            sourceHintInput.panelId = panelId;
          }
          if (extension?.id) {
            sourceHintInput.extensionId = extension.id;
          }

          return {
            app: {
              mode: "electron",
              workspaceDir,
              eventPath,
              runtime: buildStatus(),
              codex: codexAdapter.status()
            },
            focus: {
              ref: workbenchInput?.ref ?? null,
              panelId: panelId ?? null,
              panel: panel ?? null,
              extension: extension ?? null,
              window: windowsModel.find((window) => window.electronWindowId === focusedWindow?.id)
                ?? windowsModel.find((window) => panelId ? window.panelIds.includes(panelId) : false)
                ?? windowsModel[0]
                ?? null
            },
            observability: {
              visibleRefs: panelRefs.slice(0, 60),
              sourceHints: sourceHintsFor(sourceHintInput),
              timeline,
              latestEventId: events.at(-1)?.id ?? null
            },
            control: {
              methodCount: methodList.length,
              methodGroups: groupMethodsByOwner(methodList),
              recommendedActions: [
                { id: "refresh-workbench", title: "Refresh workbench", method: "agent/workbench", input: { panelId, eventCursor: events.at(-1)?.id } },
                { id: "read-state", title: "Read state", method: "plastic/state" },
                { id: "read-methods", title: "Read methods", method: "plastic/methods" },
                { id: "read-timeline", title: "Read timeline", method: "events/timeline", input: { limit: 25, ...(panelId ? { scope: { panelId } } : {}) } },
                { id: "list-refs", title: "List visible refs", method: "deixis/listVisibleRefs" },
                { id: "screenshot", title: "Capture screenshot", method: "windows/screenshot", input: workbenchInput?.ref ? { ref: workbenchInput.ref } : {} }
              ]
            },
            workspace: {
              git: await readGitStatus()
            },
            obligations: {
              orientBeforeMutation: true,
              preferRuntimeEvidence: true,
              verifyAfterMutation: true,
              keepChangesScoped: true
            }
          };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "app/diagnostics",
      title: "App diagnostics",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () =>
        Effect.sync(() => ({
          cwd: process.cwd(),
          workspaceDir,
          eventPath,
          appReady: app.isReady(),
          windowCount: BrowserWindow.getAllWindows().length,
          retainedWindowCount: windows.size,
          viteUrl: process.env.VITE_DEV_SERVER_URL ?? null
        }))
    })
  );

  await runPromise(
    methods.register({
      id: "build/status",
      title: "Build status",
      description: "Returns the local build/dev socket status and key development environment paths.",
      owner: { kind: "runtime", id: "plastic.build" },
      handler: () => Effect.sync(buildStatus)
    })
  );

  await runPromise(
    methods.register({
      id: "build/typecheck",
      title: "Run typecheck",
      description: "Runs pnpm typecheck, records stdout/stderr, and appends a durable build.typecheck.completed event.",
      owner: { kind: "runtime", id: "plastic.build" },
      handler: () =>
        Effect.promise(async () => {
          const startedAt = new Date().toISOString();
          const result = await runLocalCommand("pnpm", ["typecheck"]);
          const ok = result.exitCode === 0;
          const event = await runPromise(
            store.append(
              createEvent({
                type: "build.typecheck.completed",
                payload: {
                  ok,
                  startedAt,
                  completedAt: new Date().toISOString(),
                  command: result.command,
                  args: result.args,
                  exitCode: result.exitCode,
                  signal: result.signal,
                  stdout: result.stdout.slice(-20000),
                  stderr: result.stderr.slice(-20000)
                }
              })
            )
          );
          return { ok, ...result, eventId: event.id };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "extensions/scaffold",
      title: "Scaffold extension",
      description: "Creates a simple workspace extension under .plastic/extensions and records the scaffold event.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const extensionInput = input as {
            id?: string;
            title?: string;
            panelId?: string;
            panelTitle?: string;
            body?: string;
            kind?: string;
          };
          const rawId = extensionInput.id ?? `agent-panel-${crypto.randomUUID().slice(0, 8)}`;
          const safeId = rawId
            .replace(/^workspace\./, "")
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase();
          if (!safeId) {
            throw new Error("extensions/scaffold requires a usable id");
          }
          const extensionId = `workspace.${safeId}`;
          const panelId = extensionInput.panelId ?? `${safeId}.panel`;
          const title = extensionInput.title ?? extensionInput.panelTitle ?? safeId;
          const panelTitle = extensionInput.panelTitle ?? title;
          const extensionDir = join(plasticDir, "extensions", safeId);
          const manifestPath = join(extensionDir, "plastic.extension.json");
          const entryPath = join(extensionDir, "index.tsx");
          const manifest = {
            id: extensionId,
            title,
            panels: [
              {
                id: panelId,
                title: panelTitle,
                kind: extensionInput.kind ?? "extension",
                subtitle: "Workspace extension",
                body: extensionInput.body ?? `Generated extension panel ${panelTitle}.`
              }
            ],
            methods: []
          };
          await mkdir(extensionDir, { recursive: true });
          await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
          await writeFile(
            entryPath,
            [
              "export default {",
              `  id: ${JSON.stringify(extensionId)},`,
              `  title: ${JSON.stringify(title)}`,
              "};",
              ""
            ].join("\n"),
            "utf8"
          );
          const event = await runPromise(
            store.append(
              createEvent({
                type: "extension.scaffolded",
                payload: {
                  id: extensionId,
                  title,
                  panelId,
                  extensionDir,
                  manifestPath,
                  entryPath
                },
                scope: { extensionId }
              })
            )
          );
          return { extensionId, panelId, extensionDir, manifestPath, entryPath, manifest, eventId: event.id };
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

  await runPromise(
    methods.register({
      id: "events/append",
      title: "Append event",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const eventInput = input as { type?: string; payload?: unknown; scope?: { workspaceId?: string } };
        return store.append(
          createEvent({
            type: eventInput.type ?? "event.appended",
            payload: eventInput.payload ?? {},
            ...(eventInput.scope ? { scope: eventInput.scope } : {})
          })
        );
      }
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
        sendJson(response, 200, { ok: true, value: await buildSnapshot() });
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
await runtime.registerModules(
  [runtimeControlModule, panelControlModule, electronWindowModule, deixisMethodModule],
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
