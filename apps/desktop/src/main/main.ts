import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn as spawnProcess } from "node:child_process";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, type Rectangle } from "electron";
import { Effect } from "effect";
import { createEvent, createJsonlEventStore, createMethodRegistry, buildPlasticState, projectExtensions, projectPanels, projectWindows, type EventStore, type PlasticEvent } from "@plastic/core";
import { ipcChannels, type RpcRequest, type RpcResponse } from "../shared/ipc.js";
import { createCodexAdapter } from "./codex-adapter.js";
import { registerExtensionMethods, scanWorkspaceExtensions } from "./extension-loader.js";
import { registerPanelMailboxMethods } from "./panel-methods.js";

const workspaceDir = process.env.PLASTIC_WORKSPACE_DIR ?? process.cwd();
const plasticDir = join(workspaceDir, ".plastic");
const eventPath = join(plasticDir, "events", "events.jsonl");
mkdirSync(join(plasticDir, "events"), { recursive: true });

const runPromise = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

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

const eventStore = await createJsonlEventStore(eventPath);
const methods = createMethodRegistry();
const windows = new Set<BrowserWindow>();
const eventStreamClients = new Set<ServerResponse>();
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
const codexAdapter = createCodexAdapter({
  eventStore,
  methods,
  runPromise,
  workspaceDir,
  runtimeRpcUrl: preferredRuntimeRpcUrl,
  runtimeRpcUrls
});

type VisibleRef = {
  ref?: string;
  panel?: string;
  extension?: string;
  command?: string;
  tag: string;
  text: string;
  bounds?: Rectangle;
};

type WindowVisibleRefs = {
  windowId: number;
  refs: VisibleRef[];
};

type ScreenshotInput = {
  windowId?: number;
  ref?: string;
};

type RefInput = {
  windowId?: number;
  ref?: string;
  value?: string;
};

type VerifyRefActionInput = {
  ref?: string;
  panelId?: string;
  expectedEventType?: string;
  expectedContent?: string;
  after?: string;
  limit?: number;
};

type EventScopeInput = {
  panelId?: string;
  agentId?: string;
  extensionId?: string;
  windowId?: string;
};

type TimelineInput = {
  after?: string;
  before?: string;
  limit?: number;
  scope?: EventScopeInput;
  includeRaw?: boolean;
  includeDeltas?: boolean;
};

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

const isNoisyEvent = (event: PlasticEvent) =>
  event.type.endsWith(".delta") || event.type.includes("_delta");

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const eventSummary = (event: PlasticEvent) => {
  const payload = asRecord(event.payload);
  const scope = event.scope ?? { workspaceId: "default" };
  switch (event.type) {
    case "panel.created":
      return `Created ${asString(payload.kind) ?? "panel"} panel ${asString(payload.title) ?? asString(payload.id) ?? scope.panelId ?? "unknown"}.`;
    case "panel.removed":
      return `Removed panel ${asString(payload.id) ?? scope.panelId ?? "unknown"}.`;
    case "chat.user_message.submitted":
      return `User sent a message to ${asString(payload.chatId) ?? scope.panelId ?? "a chat panel"}.`;
    case "chat.user_message.injected":
      return `Injected a user message into ${asString(payload.chatId) ?? scope.panelId ?? "a chat panel"}.`;
    case "chat.agent_message.completed":
      return `Agent completed a message in ${asString(payload.chatId) ?? scope.panelId ?? "a chat panel"}.`;
    case "chat.codex_thread.bound":
      return `Bound ${asString(payload.chatId) ?? scope.panelId ?? "a chat panel"} to Codex thread ${asString(payload.threadId) ?? "unknown"}.`;
    case "bridge.plastic_rpc.requested":
      return `Requested Plastic RPC method ${asString(payload.method) ?? "unknown"} through the agent bridge.`;
    case "bridge.plastic_rpc.completed":
      return `Completed Plastic RPC method ${asString(payload.method) ?? "unknown"} through the agent bridge with ok=${String(payload.ok)}.`;
    case "bridge.plastic_rpc_tool.called":
      return `Codex app-server called plastic_rpc for ${asString(payload.method) ?? "unknown"}.`;
    case "extension.scaffolded":
      return `Scaffolded extension ${asString(payload.id) ?? scope.extensionId ?? "unknown"}.`;
    case "extension.discovered":
      return `Discovered extension ${asString(payload.title) ?? asString(payload.id) ?? scope.extensionId ?? "unknown"}.`;
    case "build.typecheck.completed":
      return `Typecheck completed with ok=${String(payload.ok)}.`;
    case "plastic.self_test.completed":
      return `Plastic self-test completed with ok=${String(payload.ok)}.`;
    default:
      return `${event.type} by ${event.actor.name ?? event.actor.id}.`;
  }
};

const eventMatchesScope = (event: PlasticEvent, scope?: EventScopeInput) => {
  if (!scope) {
    return true;
  }
  if (scope.panelId && event.scope.panelId !== scope.panelId) {
    return false;
  }
  if (scope.agentId && event.scope.agentId !== scope.agentId) {
    return false;
  }
  if (scope.extensionId && event.scope.extensionId !== scope.extensionId) {
    return false;
  }
  if (scope.windowId && event.scope.windowId !== scope.windowId) {
    return false;
  }
  return true;
};

const buildTimeline = (events: PlasticEvent[], input: TimelineInput = {}) => {
  const afterIndex = input.after ? events.findIndex((event) => event.id === input.after) : -1;
  const beforeIndex = input.before ? events.findIndex((event) => event.id === input.before) : events.length;
  const start = afterIndex >= 0 ? afterIndex + 1 : 0;
  const end = beforeIndex >= 0 ? beforeIndex : events.length;
  const limit = Math.max(1, Math.min(input.limit ?? 25, 200));
  const filtered = events
    .slice(start, end)
    .filter((event) => eventMatchesScope(event, input.scope))
    .filter((event) => input.includeDeltas || !isNoisyEvent(event))
    .slice(-limit);

  return {
    latestEventId: events.at(-1)?.id ?? null,
    eventCount: events.length,
    cursor: events.at(-1)?.id ?? null,
    items: filtered.map((event) => ({
      eventId: event.id,
      timestamp: event.timestamp,
      actor: event.actor,
      scope: event.scope,
      type: event.type,
      summary: eventSummary(event),
      causes: event.causationId ? [event.causationId] : [],
      effects: [],
      links: event.meta.links ?? [],
      ...(input.includeRaw ? { raw: event } : {})
    }))
  };
};

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
      eventStreamClientCount: eventStreamClients.size
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
  for (const prefix of ["panel:", "chat-compose:", "chat-shell:", "chat-status:", "chat-buttons:", "chat-log:"]) {
    if (ref.startsWith(prefix)) {
      return ref.slice(prefix.length);
    }
  }
  const messageMatch = ref.match(/^message-([^-]+-.+)-\d+$/);
  return messageMatch?.[1];
};

const bundledPanels = [
  {
    id: "chat-main",
    title: "Chat",
    kind: "chat",
    extensionId: "plastic.chat",
    subtitle: "Markdown conversation surface",
    body: "Agent messages and user messages land in Plastic's shared event stream.",
    order: 0
  },
  {
    id: "chat-peer",
    title: "Peer Chat",
    kind: "chat",
    extensionId: "plastic.chat",
    subtitle: "Second conversation surface",
    body: "A second chat panel for cross-panel message passing.",
    order: 1
  },
  {
    id: "doc-main",
    title: "Document",
    kind: "document",
    extensionId: "plastic.document",
    subtitle: "Markdown editor and preview",
    body: "The document panel starts as a projection of durable document events.",
    order: 2
  },
  {
    id: "tasks-main",
    title: "Tasks",
    kind: "tasks",
    extensionId: "plastic.tasks",
    subtitle: "Tasks and recurring work",
    body: "Recurring tasks can learn from usage and propose new buttons or flows.",
    order: 3
  },
  {
    id: "codex",
    title: "Codex",
    kind: "agent-runtime",
    extensionId: "plastic.codex",
    subtitle: "Embodied agent runtime",
    body: "Codex is available as an agent runtime that can observe and drive Plastic.",
    order: 4
  },
  {
    id: "agent-dev",
    title: "Agent Dev",
    kind: "agent-dev",
    extensionId: "plastic.agent-dev",
    subtitle: "Control plane cockpit",
    body: "Snapshot, self-test, visible refs, and build controls for agents building Plastic.",
    order: 5
  }
];

const ensureBundledPanels = async (store: EventStore) => {
  const events = await runPromise(store.list());
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

  for (const panel of bundledPanels) {
    if (existingPanelIds.has(panel.id) || introducedPanelIds.has(panel.id)) {
      continue;
    }

    await runPromise(
      store.append(
        createEvent({
          type: "panel.created",
          payload: panel,
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
      id: "plastic/methods",
      title: "Plastic methods",
      description: "Lists all registered RPC methods.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => methods.list()
    })
  );

  await runPromise(
    methods.register({
      id: "rpc/call",
      title: "Call RPC method",
      description: "Calls any registered Plastic RPC method through the shared method registry.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => Effect.promise(async () => {
        const rpcInput = input as { method?: string; input?: unknown };
        if (!rpcInput.method) {
          throw new Error("rpc/call requires method");
        }
        if (rpcInput.method === "rpc/call") {
          throw new Error("rpc/call cannot call itself");
        }
        return runPromise(methods.call(rpcInput.method, rpcInput.input));
      })
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
      id: "events/list",
      title: "List events",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => store.list()
    })
  );

  await runPromise(
    methods.register({
      id: "events/timeline",
      title: "Event timeline",
      description: "Returns deterministic, agent-readable summaries of recent events with cursors and links.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.map(store.list(), (events) => buildTimeline(events, input as TimelineInput | undefined))
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
      id: "panels/list",
      title: "List panels",
      description: "Returns the panel read model rebuilt from durable events.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => Effect.map(store.list(), projectPanels)
    })
  );

  await runPromise(
    methods.register({
      id: "panels/get",
      title: "Get panel",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.map(store.list(), (events) => {
          const id = (input as { id?: string }).id;
          const panel = projectPanels(events).find((candidate) => candidate.id === id);
          if (!panel) {
            throw new Error(`Panel not found: ${id}`);
          }
          return panel;
        })
    })
  );

  await runPromise(
    methods.register({
      id: "panels/create",
      title: "Create panel",
      description: "Appends a durable panel.created event. Renderer windows project it immediately.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const panelInput = input as {
          id?: string;
          title?: string;
          kind?: string;
          extensionId?: string;
          subtitle?: string;
          body?: string;
          windowId?: string;
          order?: number;
        };
        const title = panelInput.title ?? "Untitled panel";
        const id = panelInput.id ?? `panel-${crypto.randomUUID().slice(0, 8)}`;
        const extensionId = panelInput.extensionId ?? "plastic.user";
        const scope = {
          panelId: id,
          extensionId
        } as { panelId: string; extensionId: string; windowId?: string };
        if (panelInput.windowId) {
          scope.windowId = panelInput.windowId;
        }

        return store.append(
          createEvent({
            type: "panel.created",
            payload: {
              id,
              title,
              kind: panelInput.kind ?? "generic",
              extensionId,
              subtitle: panelInput.subtitle,
              body: panelInput.body ?? "This panel was created through Plastic RPC.",
              windowId: panelInput.windowId,
              order: panelInput.order
            },
            scope
          })
        );
      }
    })
  );

  await runPromise(
    methods.register({
      id: "panels/rename",
      title: "Rename panel",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const panelInput = input as { id?: string; title?: string; subtitle?: string };
        if (!panelInput.id || !panelInput.title) {
          throw new Error("panels/rename requires id and title");
        }

        return store.append(
          createEvent({
            type: "panel.renamed",
            payload: {
              id: panelInput.id,
              title: panelInput.title,
              subtitle: panelInput.subtitle
            },
            scope: { panelId: panelInput.id }
          })
        );
      }
    })
  );

  await runPromise(
    methods.register({
      id: "panels/move",
      title: "Move panel",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const panelInput = input as { id?: string; windowId?: string; order?: number };
        if (!panelInput.id) {
          throw new Error("panels/move requires id");
        }

        return store.append(
          createEvent({
            type: "panel.moved",
            payload: {
              id: panelInput.id,
              windowId: panelInput.windowId,
              order: panelInput.order
            },
            scope: { panelId: panelInput.id }
          })
        );
      }
    })
  );

  await runPromise(
    methods.register({
      id: "panels/remove",
      title: "Remove panel",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const panelInput = input as { id?: string; reason?: string };
        if (!panelInput.id) {
          throw new Error("panels/remove requires id");
        }

        return store.append(
          createEvent({
            type: "panel.removed",
            payload: {
              id: panelInput.id,
              reason: panelInput.reason
            },
            scope: { panelId: panelInput.id }
          })
        );
      }
    })
  );

  await runPromise(
    methods.register({
      id: "panels/close",
      title: "Close panel",
      description: "Closes a panel from the current workspace projection by appending panel.removed.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const panelInput = input as { id?: string; reason?: string };
        if (!panelInput.id) {
          throw new Error("panels/close requires id");
        }

        return store.append(
          createEvent({
            type: "panel.removed",
            payload: {
              id: panelInput.id,
              reason: panelInput.reason ?? "closed"
            },
            scope: { panelId: panelInput.id }
          })
        );
      }
    })
  );

  await runPromise(
    methods.register({
      id: "windows/list",
      title: "List windows",
      description: "Returns known windows rebuilt from durable events.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => Effect.map(store.list(), (events) => projectWindows(events))
    })
  );

  await runPromise(
    methods.register({
      id: "windows/create",
      title: "Create window",
      description: "Opens a new Electron window and appends window.created.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const windowInput = input as { title?: string };
          return createWindow(windowInput.title);
        })
    })
  );

  await runPromise(
    methods.register({
      id: "windows/focusPanel",
      title: "Focus panel",
      description: "Scrolls a visible panel into view and focuses its window.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const panelId = (input as { panelId?: string }).panelId;
          if (!panelId) {
            throw new Error("windows/focusPanel requires panelId");
          }
          const ref = `panel:${panelId}`;
          const result = [];
          for (const window of BrowserWindow.getAllWindows()) {
            const found = await window.webContents.executeJavaScript(scrollRefIntoViewScript(ref)) as boolean;
            if (found) {
              window.focus();
            }
            result.push({ windowId: window.id, found });
          }
          return result;
        })
    })
  );

  await runPromise(
    methods.register({
      id: "windows/scrollToRef",
      title: "Scroll to visible ref",
      description: "Scrolls any visible data-plastic-ref into view.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const ref = (input as { ref?: string }).ref;
          if (!ref) {
            throw new Error("windows/scrollToRef requires ref");
          }
          const result = [];
          for (const window of BrowserWindow.getAllWindows()) {
            const found = await window.webContents.executeJavaScript(scrollRefIntoViewScript(ref)) as boolean;
            if (found) {
              window.focus();
            }
            result.push({ windowId: window.id, found });
          }
          return result;
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

  await runPromise(
    methods.register({
      id: "app/setTheme",
      title: "Set theme",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const theme = (input as { theme?: "light" | "dark" }).theme === "dark" ? "dark" : "light";
        return store.append(
          createEvent({
            type: "theme.changed",
            payload: { theme }
          })
        );
      }
    })
  );

  await runPromise(
    methods.register({
      id: "chats/addButton",
      title: "Add chat button",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const buttonInput = input as {
          chatId?: string;
          button?: {
            id?: string;
            label?: string;
            action?: {
              method: string;
              input?: unknown;
            };
          };
        };
        const chatId = buttonInput.chatId ?? "chat-main";
        const button = buttonInput.button;
        if (!button?.id || !button.label || !button.action?.method) {
          throw new Error("chats/addButton requires button.id, button.label, and button.action.method");
        }

        return store.append(
          createEvent({
            type: "panel.button.added",
            payload: {
              panelId: chatId,
              button
            },
            scope: { panelId: chatId }
          })
        );
      }
    })
  );

  await runPromise(
    methods.register({
      id: "chats/injectUserMessage",
      title: "Inject user message into chat",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const messageInput = input as { chatId?: string; content?: string };
        const chatId = messageInput.chatId ?? "chat-main";
        if (!messageInput.content) {
          throw new Error("chats/injectUserMessage requires content");
        }

        return store.append(
          createEvent({
            type: "chat.user_message.injected",
            payload: {
              chatId,
              content: messageInput.content
            },
            scope: { panelId: chatId }
          })
        );
      }
    })
  );

  await runPromise(
    methods.register({
      id: "deixis/listVisibleRefs",
      title: "List visible UI references",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () =>
        Effect.promise(listVisibleRefs)
    })
  );

  await runPromise(
    methods.register({
      id: "windows/screenshot",
      title: "Capture window screenshot",
      description: "Captures the focused window, a specific window id, or a visible data-plastic-ref region as a data URL.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(() => captureWindow(input as ScreenshotInput | undefined))
    })
  );

  await runPromise(
    methods.register({
      id: "deixis/resolveRef",
      title: "Resolve visible UI reference",
      description: "Explains a data-plastic-ref with DOM, panel, extension, command, source hints, and recent event lineage.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const ref = (input as { ref?: string }).ref;
          if (!ref) {
            throw new Error("deixis/resolveRef requires ref");
          }

          const events = await runPromise(store.list());
          const panels = projectPanels(events);
          const extensions = projectExtensions(events);
          const visible = await resolveVisibleRef(ref);
          const panelId = visible?.ref.panel ?? panelIdFromRef(ref);
          const panel = panelId ? panels.find((candidate) => candidate.id === panelId) : undefined;
          const extensionId = visible?.ref.extension ?? panel?.extensionId;
          const extension = extensionId ? extensions.find((candidate) => candidate.id === extensionId) : undefined;
          const isChatCompose = ref.startsWith("chat-compose:");
          const command = visible?.ref.command ?? (isChatCompose ? "chats/sendToCodex" : undefined);
          const lineage = findRecentEvents(
            events,
            (event) =>
              !isNoisyEvent(event) && (
                event.scope.panelId === panelId ||
                event.scope.extensionId === extensionId ||
                event.type.includes(panelId ?? "__no_panel__") ||
                event.type.includes(extensionId ?? "__no_extension__")
              ),
            12
          );
          const refTimelineInput: TimelineInput = { limit: 12 };
          if (panelId) {
            refTimelineInput.scope = { panelId };
          }
          const timeline = buildTimeline(events, refTimelineInput);
          const binding = panelId && panel?.kind === "chat"
            ? await runPromise(methods.call("chats/getBinding", { chatId: panelId })).catch((error) => ({
              error: error instanceof Error ? error.message : String(error)
            }))
            : null;

          const sourceHintInput: { ref?: string; panelId?: string; extensionId?: string; command?: string } = { ref };
          if (panelId) {
            sourceHintInput.panelId = panelId;
          }
          if (extensionId) {
            sourceHintInput.extensionId = extensionId;
          }
          if (command) {
            sourceHintInput.command = command;
          }

          return {
            ref,
            element: visible ? {
              windowId: visible.windowId,
              tag: visible.ref.tag,
              text: visible.ref.text,
              bounds: visible.ref.bounds ?? null,
              attributes: {
                "data-plastic-ref": visible.ref.ref ?? ref,
                ...(visible.ref.panel ? { "data-plastic-panel": visible.ref.panel } : {}),
                ...(visible.ref.extension ? { "data-plastic-extension": visible.ref.extension } : {}),
                ...(visible.ref.command ? { "data-plastic-command": visible.ref.command } : {})
              }
            } : null,
            visible,
            ownership: {
              panelId: panelId ?? null,
              extensionId: extensionId ?? null,
              methodId: command ?? null,
              commandId: command ?? null,
              agentId: panel?.kind === "chat" ? "codex" : null
            },
            state: {
              panel: panel ?? null,
              extension: extension ?? null,
              binding,
              timeline,
              resourceLinks: [
                ...(panelId ? [{ rel: "panel", href: "panels/get", method: "panels/get", target: panelId }] : []),
                ...(extensionId ? [{ rel: "extension", href: "extensions/get", method: "extensions/get", target: extensionId }] : []),
                ...(panelId ? [{ rel: "timeline", href: "events/timeline", method: "events/timeline", target: panelId }] : [])
              ]
            },
            panel,
            extension,
            command,
            sourceHints: sourceHintsFor(sourceHintInput),
            lineage,
            verification: [
              ...(panelId ? [
                { id: "verify-ref-action", title: "Verify ref action", method: "deixis/verifyRefAction", input: { ref, panelId, limit: 30 } },
                { id: "timeline-after-action", title: "Verify panel timeline", method: "events/timeline", input: { scope: { panelId }, limit: 12 } }
              ] : []),
              { id: "visible-after-action", title: "Verify visible refs", method: "deixis/listVisibleRefs" },
              { id: "screenshot-after-action", title: "Verify screenshot", method: "windows/screenshot", input: { ref } }
            ],
            actions: [
              ...(panelId ? [
                { id: "get-panel", title: "Get panel", method: "panels/get", input: { id: panelId } },
                { id: "rename-panel", title: "Rename panel", method: "panels/rename" }
              ] : []),
              ...(isChatCompose && panelId ? [
                { id: "fill-compose", title: "Fill chat compose", method: "deixis/fillRef", input: { ref, value: "" } },
                { id: "send-compose", title: "Submit chat compose", method: "deixis/clickRef", input: { ref } },
                { id: "send-chat-direct", title: "Send chat message directly", method: "chats/sendToCodex", input: { chatId: panelId, content: "" } }
              ] : []),
              ...(extensionId ? [
                { id: "get-extension", title: "Get extension", method: "extensions/get", input: { id: extensionId } }
              ] : []),
              ...(command ? [
                { id: "invoke-command", title: "Invoke command", method: command }
              ] : [])
            ]
          };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "deixis/evalDom",
      title: "Evaluate DOM script",
      description: "Permissive v0 DOM evaluation in the focused window.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const code = (input as { code?: string }).code;
          if (!code) {
            throw new Error("Missing DOM eval code");
          }
          const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          if (!target) {
            throw new Error("No window available");
          }
          return target.webContents.executeJavaScript(code);
        })
    })
  );

  await runPromise(
    methods.register({
      id: "deixis/verifyRefAction",
      title: "Verify ref action",
      description: "Verifies that a recent ref-driven action produced the expected durable event.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const verifyInput = input as VerifyRefActionInput;
          if (!verifyInput.ref) {
            throw new Error("deixis/verifyRefAction requires ref");
          }
          const events = await runPromise(store.list());
          const panelId = verifyInput.panelId ?? panelIdFromRef(verifyInput.ref);
          const afterIndex = verifyInput.after ? events.findIndex((event) => event.id === verifyInput.after) : -1;
          const candidates = events
            .slice(afterIndex >= 0 ? afterIndex + 1 : Math.max(0, events.length - (verifyInput.limit ?? 200)))
            .filter((event) => {
              if (panelId && event.scope.panelId !== panelId) {
                return false;
              }
              if (verifyInput.expectedEventType && event.type !== verifyInput.expectedEventType) {
                return false;
              }
              if (verifyInput.expectedContent) {
                const payload = asRecord(event.payload);
                const content = asString(payload.content) ?? "";
                if (content !== verifyInput.expectedContent) {
                  return false;
                }
              }
              return true;
            });
          const refEvents = events
            .slice(afterIndex >= 0 ? afterIndex + 1 : Math.max(0, events.length - (verifyInput.limit ?? 200)))
            .filter((event) => {
              const payload = asRecord(event.payload);
              return (event.type === "deixis.ref.filled" || event.type === "deixis.ref.clicked") && payload.ref === verifyInput.ref;
            });
          const timelineInput: TimelineInput = { limit: Math.min(verifyInput.limit ?? 20, 100) };
          if (panelId) {
            timelineInput.scope = { panelId };
          }
          if (verifyInput.after) {
            timelineInput.after = verifyInput.after;
          }
          const timeline = buildTimeline(events, timelineInput);
          const ok = candidates.length > 0;
          const result = {
            ok,
            ref: verifyInput.ref,
            panelId: panelId ?? null,
            expectedEventType: verifyInput.expectedEventType ?? null,
            expectedContent: verifyInput.expectedContent ?? null,
            matchedEvents: candidates.slice(-10).map((event) => ({
              eventId: event.id,
              type: event.type,
              timestamp: event.timestamp,
              summary: eventSummary(event),
              payload: event.payload
            })),
            refEvents: refEvents.slice(-10).map((event) => ({
              eventId: event.id,
              type: event.type,
              timestamp: event.timestamp,
              payload: event.payload
            })),
            latestEventId: events.at(-1)?.id ?? null,
            eventCursor: events.at(-1)?.id ?? null,
            timeline
          };
          const event = await runPromise(
            store.append(
              createEvent({
                type: "deixis.ref_action.verified",
                payload: result,
                ...(panelId ? { scope: { panelId } } : {})
              })
            )
          );
          return { ...result, verificationEventId: event.id };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "deixis/clickRef",
      title: "Click visible UI reference",
      description: "Clicks a visible data-plastic-ref in the focused or selected window and records the action.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const refInput = input as RefInput;
          if (!refInput.ref) {
            throw new Error("deixis/clickRef requires ref");
          }
          const latestFilledValue = await runPromise(store.list()).then((events) => {
            const filled = events
              .filter((event) => event.type === "deixis.ref.filled")
              .map((event) => asRecord(event.payload))
              .filter((payload) => payload.ref === refInput.ref && typeof payload.value === "string")
              .at(-1);
            return typeof filled?.value === "string" ? filled.value : undefined;
          });
          const target = findWindow(refInput.windowId);
          if (!target) {
            throw new Error("No window available");
          }
          const result = await target.webContents.executeJavaScript(`
            (() => {
              const ref = ${JSON.stringify(refInput.ref)};
              const latestFilledValue = ${JSON.stringify(latestFilledValue)};
              const element = [...document.querySelectorAll("[data-plastic-ref]")]
                .find((candidate) => candidate.dataset.plasticRef === ref);
              if (!element) {
                return { clicked: false, reason: "ref not found" };
              }
              ${scrollRefIntoViewScript(refInput.ref)}
              if (element instanceof HTMLFormElement) {
                const field = element.querySelector("textarea, input");
                if (field && latestFilledValue !== undefined && field.value.trim().length === 0) {
                  field.value = latestFilledValue;
                  field.dispatchEvent(new Event("input", { bubbles: true }));
                  field.dispatchEvent(new Event("change", { bubbles: true }));
                }
                element.requestSubmit();
              } else {
                element.click();
              }
              return {
                clicked: true,
                ref,
                tag: element.tagName.toLowerCase(),
                submitted: element instanceof HTMLFormElement,
                text: (element.innerText || element.textContent || "").slice(0, 240)
              };
            })()
          `) as unknown;
          const event = await runPromise(
            store.append(
              createEvent({
                type: "deixis.ref.clicked",
                payload: {
                  ref: refInput.ref,
                  windowId: target.id,
                  result
                }
              })
            )
          );
          return { windowId: target.id, ref: refInput.ref, result, eventId: event.id };
        })
    })
  );

  await runPromise(
    methods.register({
      id: "deixis/fillRef",
      title: "Fill visible UI reference",
      description: "Fills an input or textarea inside a visible data-plastic-ref and records the action.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) =>
        Effect.promise(async () => {
          const refInput = input as RefInput;
          if (!refInput.ref) {
            throw new Error("deixis/fillRef requires ref");
          }
          if (refInput.value === undefined) {
            throw new Error("deixis/fillRef requires value");
          }
          const target = findWindow(refInput.windowId);
          if (!target) {
            throw new Error("No window available");
          }
          const result = await target.webContents.executeJavaScript(`
            (() => {
              const ref = ${JSON.stringify(refInput.ref)};
              const value = ${JSON.stringify(refInput.value)};
              const root = [...document.querySelectorAll("[data-plastic-ref]")]
                .find((candidate) => candidate.dataset.plasticRef === ref);
              if (!root) {
                return { filled: false, reason: "ref not found" };
              }
              ${scrollRefIntoViewScript(refInput.ref)}
              const element = root.matches("input, textarea")
                ? root
                : root.querySelector("textarea, input");
              if (!element) {
                return { filled: false, reason: "no input or textarea found" };
              }
              element.focus();
              element.value = value;
              element.dispatchEvent(new Event("input", { bubbles: true }));
              element.dispatchEvent(new Event("change", { bubbles: true }));
              return {
                filled: true,
                ref,
                tag: element.tagName.toLowerCase(),
                length: value.length
              };
            })()
          `) as unknown;
          const event = await runPromise(
            store.append(
              createEvent({
                type: "deixis.ref.filled",
                payload: {
                  ref: refInput.ref,
                  windowId: target.id,
                  valueLength: refInput.value.length,
                  value: refInput.value,
                  result
                }
              })
            )
          );
          return { windowId: target.id, ref: refInput.ref, result, eventId: event.id };
        })
    })
  );
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (body.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "http://127.0.0.1:5173",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(value));
};

const writeSse = (response: ServerResponse, event: string, data: unknown) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

await runPromise(
  eventStore.subscribe((event) => {
    for (const response of eventStreamClients) {
      writeSse(response, "plastic.event", event);
    }
  })
);

const startRuntimeSocket = () => {
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    try {
      if (request.method === "GET" && request.url === "/healthz") {
        sendJson(response, 200, { ok: true, service: "plastic.runtime" });
        return;
      }

      if (request.method === "GET" && request.url === "/state") {
        const state = await runPromise(buildPlasticState(eventStore, methods));
        sendJson(response, 200, { ok: true, value: state });
        return;
      }

      if (request.method === "GET" && request.url === "/methods") {
        const value = await runPromise(methods.list());
        sendJson(response, 200, { ok: true, value });
        return;
      }

      if (request.method === "GET" && request.url === "/events/stream") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": "http://127.0.0.1:5173"
        });
        eventStreamClients.add(response);
        writeSse(response, "plastic.ready", { ok: true });
        request.on("close", () => {
          eventStreamClients.delete(response);
        });
        return;
      }

      if (request.method === "POST" && request.url === "/rpc") {
        const body = await readJsonBody(request) as RpcRequest;
        const value = await runPromise(methods.call(body.method, body.input));
        sendJson(response, 200, { ok: true, value });
        return;
      }

      sendJson(response, 404, { ok: false, error: "Not found" });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(runtimePort, runtimeHost);
  return server;
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

const createWindow = async (title = "Plastic") => {
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
};

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

await ensureBundledPanels(eventStore);
await registerRuntimeMethods(eventStore);
await registerExtensionMethods({ workspaceDir, eventStore, methods, runPromise });
await registerPanelMailboxMethods({ eventStore, methods, runPromise });
await codexAdapter.registerMethods();
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
            methods: extension.methods.map((method) => method.id)
          },
          errors: extension.errors
        },
        scope: { extensionId: extension.id }
      })
    )
  );
}
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

const runtimeSocket = startRuntimeSocket();
const buildSocket = startBuildSocket();

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
  runtimeSocket.close();
  buildSocket.close();
});
