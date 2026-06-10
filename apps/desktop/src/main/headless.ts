import { createServer, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import {
  buildPlasticState,
  buildTimeline,
  createEvent,
  createJsonlEventStore,
  createMethodRegistry,
  groupMethodsByOwner,
  projectExtensions,
  projectPanels,
  projectWindows,
  selectEvents,
  type EventListInput,
  type EventStore,
  type PlasticEvent
} from "@plastic/core";
import { activateExtensions } from "./extension-host.js";
import { registerExtensionMethods, scanBundledExtensions, scanWorkspaceExtensions } from "./extension-loader.js";
import { registerPanelMailboxMethods } from "./panel-methods.js";
import { resolvePlasticRuntimePaths } from "./runtime-paths.js";

const workspaceDir = process.env.PLASTIC_WORKSPACE_DIR ?? process.cwd();
const plasticDir = join(workspaceDir, ".plastic");
const runtimePaths = resolvePlasticRuntimePaths(workspaceDir);
const eventPath = runtimePaths.eventPath;
const bundledExtensionsDir = join(workspaceDir, "apps", "desktop", "extensions", "bundled");
const runtimeHost = process.env.PLASTIC_RUNTIME_HOST ?? "0.0.0.0";
const runtimePort = Number(process.env.PLASTIC_RUNTIME_PORT ?? 7331);
const runtimeRpcUrl = process.env.PLASTIC_RPC_URL ?? `http://127.0.0.1:${runtimePort}/rpc`;
const startedAt = new Date().toISOString();

mkdirSync(dirname(eventPath), { recursive: true });

const runPromise = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
const execFileAsync = promisify(execFile);
const eventStore = await createJsonlEventStore(eventPath);
const methods = createMethodRegistry();
const eventStreamClients = new Set<ServerResponse>();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

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

const sendJson = (response: ServerResponse, statusCode: number, value: unknown) => {
  response.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "content-type": "application/json"
  });
  response.end(JSON.stringify(value));
};

const readJsonBody = async (request: NodeJS.ReadableStream) =>
  new Promise<unknown>((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      try {
        resolve(body.length > 0 ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

const appendAndBroadcast = async (event: PlasticEvent) => {
  for (const client of eventStreamClients) {
    client.write(`event: plastic.event\n`);
    client.write(`data: ${JSON.stringify({ id: event.id, type: event.type, timestamp: event.timestamp })}\n\n`);
  }
  return event;
};

const appendEvent = async (store: EventStore, eventInput: Parameters<typeof createEvent>[0]) =>
  appendAndBroadcast(await runPromise(store.append(createEvent(eventInput))));

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

const registerHeadlessMethods = async () => {
  await runPromise(methods.register({
    id: "plastic/state",
    title: "Plastic state",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: () => Effect.map(buildPlasticState(eventStore, methods), (state) => ({
      ...state,
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
    }))
  }));

  await runPromise(methods.register({
    id: "plastic/methods",
    title: "Plastic methods",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: () => methods.list()
  }));

  await runPromise(methods.register({
    id: "methods/describe",
    title: "Describe method",
    description: "Returns one RPC method with schemas, examples, effects, links, and ownership metadata.",
    owner: { kind: "runtime", id: "plastic.runtime" },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "RPC method id to describe." }
      }
    },
    examples: [
      {
        title: "Describe panel movement",
        input: { id: "panels/move" }
      }
    ],
    handler: (input) => Effect.promise(async () => {
      const id = (input as { id?: string }).id;
      if (!id) {
        throw new Error("methods/describe requires id");
      }
      const method = await runPromise(methods.get(id));
      if (!method) {
        throw new Error(`Method not found: ${id}`);
      }
      return method;
    })
  }));

  await runPromise(methods.register({
    id: "rpc/call",
    title: "Call RPC method",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: (input) => Effect.promise(async () => {
      const rpcInput = input as { method?: string; input?: unknown };
      if (!rpcInput.method || rpcInput.method === "rpc/call") {
        throw new Error("rpc/call requires a non-recursive method");
      }
      return runPromise(methods.call(rpcInput.method, rpcInput.input));
    })
  }));

  await runPromise(methods.register({
    id: "plastic/snapshot",
    title: "Plastic snapshot",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: () => Effect.promise(async () => {
      const events = await runPromise(eventStore.list());
      const registeredMethods = await runPromise(methods.list());
      const panels = projectPanels(events);
      return {
        app: { name: "Plastic", mode: "headless", workspaceDir, eventPath },
        build: buildStatus(),
        runtime: { windowCount: 0, eventStreamClientCount: eventStreamClients.size },
        codex: { connected: false, initialized: false, pid: null, pendingRequests: 0 },
        methods: { count: registeredMethods.length, items: registeredMethods },
        panels,
        windows: projectWindows(events, panels),
        extensions: projectExtensions(events),
        visibleRefs: [],
        events: { count: events.length, latest: events.at(-1) ?? null, recent: events.slice(-30) }
      };
    })
  }));

  await runPromise(methods.register({
    id: "agent/workbench",
    title: "Agent workbench",
    description: "Returns a high-signal workbench packet for agents in headless mode.",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: (input) => Effect.promise(async () => {
      const workbenchInput = input as { panelId?: string; eventCursor?: string; limit?: number } | undefined;
      const events = await runPromise(eventStore.list());
      const methodList = await runPromise(methods.list());
      const panels = projectPanels(events);
      const extensions = projectExtensions(events);
      const panel = workbenchInput?.panelId ? panels.find((candidate) => candidate.id === workbenchInput.panelId) : undefined;
      const extension = panel?.extensionId ? extensions.find((candidate) => candidate.id === panel.extensionId) : undefined;
      const timeline = buildTimeline(events, {
        limit: workbenchInput?.limit ?? 25,
        ...(workbenchInput?.eventCursor ? { after: workbenchInput.eventCursor } : {}),
        ...(panel?.id ? { scope: { panelId: panel.id } } : {})
      });

      return {
        app: {
          mode: "headless",
          workspaceDir,
          eventPath,
          runtime: buildStatus(),
          codex: { connected: false, initialized: false, pid: null, pendingRequests: 0 }
        },
        focus: {
          ref: null,
          panelId: panel?.id ?? null,
          panel: panel ?? null,
          extension: extension ?? null,
          window: projectWindows(events, panels)[0] ?? null
        },
        observability: {
          visibleRefs: [],
          sourceHints: [],
          timeline,
          latestEventId: events.at(-1)?.id ?? null
        },
        control: {
          methodCount: methodList.length,
          methodGroups: groupMethodsByOwner(methodList),
          recommendedActions: [
            { id: "refresh-workbench", title: "Refresh workbench", method: "agent/workbench", input: { panelId: panel?.id, eventCursor: events.at(-1)?.id } },
            { id: "read-state", title: "Read state", method: "plastic/state" },
            { id: "read-methods", title: "Read methods", method: "plastic/methods" },
            { id: "read-timeline", title: "Read timeline", method: "events/list", input: { limit: 25 } }
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
  }));

  await runPromise(methods.register({
    id: "plastic/selfTest",
    title: "Plastic self-test",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: () => Effect.promise(async () => {
      const events = await runPromise(eventStore.list());
      const checks = [
        { id: "event-store:list", ok: true, details: { count: events.length } },
        { id: "methods:list", ok: true, details: { count: (await runPromise(methods.list())).length } },
        { id: "panels:project", ok: true, details: { count: projectPanels(events).length } },
        { id: "extensions:project", ok: true, details: { count: projectExtensions(events).length } }
      ];
      const event = await appendEvent(eventStore, {
        type: "plastic.self_test.completed",
        payload: { ok: true, checks }
      });
      return { ok: true, checks, eventId: event.id };
    })
  }));

  await runPromise(methods.register({
    id: "events/list",
    title: "List events",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: (input) => Effect.map(eventStore.list(), (events) => selectEvents(events, input as EventListInput | undefined))
  }));

  await runPromise(methods.register({
    id: "panels/list",
    title: "List panels",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: () => Effect.map(eventStore.list(), projectPanels)
  }));

  await runPromise(methods.register({
    id: "panels/create",
    title: "Create panel",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: (input) => Effect.promise(async () => {
      const panelInput = input as { id?: string; title?: string; kind?: string; extensionId?: string; rendererId?: string; subtitle?: string; body?: string; order?: number };
      const id = panelInput.id ?? `panel-${crypto.randomUUID().slice(0, 8)}`;
      return appendEvent(eventStore, {
        type: "panel.created",
        payload: {
          id,
          title: panelInput.title ?? "Untitled panel",
          kind: panelInput.kind ?? "generic",
          extensionId: panelInput.extensionId ?? "plastic.user",
          rendererId: panelInput.rendererId,
          subtitle: panelInput.subtitle,
          body: panelInput.body ?? "This panel was created through Plastic RPC.",
          order: panelInput.order
        },
        scope: { panelId: id, extensionId: panelInput.extensionId ?? "plastic.user" }
      });
    })
  }));

  await runPromise(methods.register({
    id: "panels/move",
    title: "Move panel",
    description: "Durably updates a panel's order and optionally assigns it to a window.",
    owner: { kind: "runtime", id: "plastic.runtime" },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Panel id to move." },
        windowId: { type: "string", description: "Optional target window id." },
        order: { type: "number", description: "Optional projected ordering value." }
      }
    },
    examples: [
      {
        title: "Move a chat after the first panel",
        input: { id: "chat-main", order: 2 },
        expectedEvents: ["panel.moved"],
        verifyWith: { method: "panels/list", input: {} }
      }
    ],
    effects: {
      durableEvents: ["panel.moved"],
      mutatesProjection: ["panels", "windows"]
    },
    preconditions: ["The panel id must exist for the move to affect projected layout."],
    reversibility: {
      reversible: true,
      method: "panels/move",
      notes: "Call again with the previous order/windowId."
    },
    handler: (input) => Effect.promise(async () => {
      const panelInput = input as { id?: string; windowId?: string; order?: number };
      if (!panelInput.id) {
        throw new Error("panels/move requires id");
      }
      return appendEvent(eventStore, {
        type: "panel.moved",
        payload: {
          id: panelInput.id,
          windowId: panelInput.windowId,
          order: panelInput.order
        },
        scope: { panelId: panelInput.id }
      });
    })
  }));

  await runPromise(methods.register({
    id: "panels/rename",
    title: "Rename panel",
    description: "Durably changes a panel title and optional subtitle.",
    owner: { kind: "runtime", id: "plastic.runtime" },
    inputSchema: {
      type: "object",
      required: ["id", "title"],
      properties: {
        id: { type: "string", description: "Panel id to rename." },
        title: { type: "string", description: "New panel title." },
        subtitle: { type: "string", description: "Optional new panel subtitle." }
      }
    },
    examples: [
      {
        title: "Rename a chat panel",
        input: { id: "chat-main", title: "Research Chat" },
        expectedEvents: ["panel.renamed"],
        verifyWith: { method: "panels/list", input: {} }
      }
    ],
    effects: {
      durableEvents: ["panel.renamed"],
      mutatesProjection: ["panels"]
    },
    preconditions: ["The panel id must exist for the rename to affect projected layout."],
    reversibility: {
      reversible: true,
      method: "panels/rename",
      notes: "Call again with the previous title/subtitle."
    },
    handler: (input) => Effect.promise(async () => {
      const panelInput = input as { id?: string; title?: string; subtitle?: string };
      if (!panelInput.id || !panelInput.title) {
        throw new Error("panels/rename requires id and title");
      }
      return appendEvent(eventStore, {
        type: "panel.renamed",
        payload: {
          id: panelInput.id,
          title: panelInput.title,
          subtitle: panelInput.subtitle
        },
        scope: { panelId: panelInput.id }
      });
    })
  }));

  await runPromise(methods.register({
    id: "panels/close",
    title: "Close panel",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: (input) => Effect.promise(async () => {
      const id = (input as { id?: string }).id;
      if (!id) {
        throw new Error("panels/close requires id");
      }
      return appendEvent(eventStore, {
        type: "panel.removed",
        payload: { id },
        scope: { panelId: id }
      });
    })
  }));

  await runPromise(methods.register({
    id: "app/setTheme",
    title: "Set theme",
    description: "Durably changes the app theme projected by renderer windows.",
    owner: { kind: "runtime", id: "plastic.runtime" },
    inputSchema: {
      type: "object",
      properties: {
        theme: { enum: ["light", "dark"], description: "Theme to project in the app UI." }
      }
    },
    examples: [
      {
        title: "Switch to dark mode",
        input: { theme: "dark" },
        expectedEvents: ["theme.changed"],
        verifyWith: { method: "plastic/state", input: {} }
      }
    ],
    effects: {
      durableEvents: ["theme.changed"],
      mutatesProjection: ["app.theme"]
    },
    reversibility: {
      reversible: true,
      method: "app/setTheme",
      notes: "Call again with the previous theme."
    },
    handler: (input) => Effect.promise(async () => appendEvent(eventStore, {
      type: "theme.changed",
      payload: { theme: (input as { theme?: string }).theme === "dark" ? "dark" : "light" }
    }))
  }));

  await runPromise(methods.register({
    id: "codex/status",
    title: "Codex status",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: () => Effect.succeed({ connected: false, initialized: false, pid: null, pendingRequests: 0 })
  }));

  await runPromise(methods.register({
    id: "chats/getBinding",
    title: "Get chat binding",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: (input) => Effect.succeed({
      chatId: (input as { chatId?: string }).chatId ?? "chat-main",
      runtimeId: "headless",
      threadId: null,
      activeTurnId: null,
      activeTurnStatus: null
    })
  }));

  await runPromise(methods.register({
    id: "chats/sendToCodex",
    title: "Send message to headless chat",
    owner: { kind: "runtime", id: "plastic.runtime" },
    handler: (input) => Effect.promise(async () => {
      const messageInput = input as { chatId?: string; content?: string };
      const chatId = messageInput.chatId ?? "chat-main";
      if (!messageInput.content) {
        throw new Error("chats/sendToCodex requires content");
      }
      const userEvent = await appendEvent(eventStore, {
        type: "chat.user_message.submitted",
        payload: { chatId, content: messageInput.content },
        scope: { panelId: chatId }
      });
      const agentEvent = await appendEvent(eventStore, {
        type: "chat.agent_message.completed",
        payload: {
          chatId,
          itemId: `headless-${crypto.randomUUID().slice(0, 8)}`,
          content: "Headless runtime received this message. Codex app-server passthrough is disabled in this mode."
        },
        scope: { panelId: chatId },
        causationId: userEvent.id
      });
      return { userEvent, agentEvent };
    })
  }));

};

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
await registerHeadlessMethods();
await registerExtensionMethods({ workspaceDir, eventStore, methods, runPromise });
await activateExtensions({ workspaceDir, eventStore, methods, runPromise });
await registerPanelMailboxMethods({ eventStore, methods, runPromise });
await appendEvent(eventStore, {
  type: "runtime.started",
  payload: { mode: "headless" }
});

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && request.url === "/events/stream") {
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive"
    });
    response.write("\n");
    eventStreamClients.add(response);
    request.on("close", () => eventStreamClients.delete(response));
    return;
  }

  if (request.method === "POST" && request.url === "/rpc") {
    try {
      const body = await readJsonBody(request) as { method?: string; input?: unknown };
      if (!body.method) {
        throw new Error("RPC request requires method");
      }
      const value = await runPromise(methods.call(body.method, body.input));
      sendJson(response, 200, { ok: true, value });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
});

server.listen(runtimePort, runtimeHost, () => {
  console.log(`[plastic:headless] RPC listening at ${runtimeRpcUrl}`);
});

process.on("SIGINT", () => {
  server.close();
  process.exit(130);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(143);
});
