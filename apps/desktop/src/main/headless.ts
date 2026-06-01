import { createServer, type ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import {
  buildPlasticState,
  createEvent,
  createJsonlEventStore,
  createMethodRegistry,
  projectExtensions,
  projectPanels,
  projectWindows,
  type EventStore,
  type PlasticEvent
} from "@plastic/core";
import { registerExtensionMethods, scanBundledExtensions, scanWorkspaceExtensions } from "./extension-loader.js";
import { registerPanelMailboxMethods } from "./panel-methods.js";

type EventListInput = {
  limit?: number | "all";
  types?: string[];
};

type ChatMessagesInput = {
  chatId?: string;
  limit?: number;
};

type ChatMessageProjection = {
  id: string;
  eventId: string;
  timestamp: string;
  content: string;
  role: "user" | "agent" | "system" | "peer";
  streaming: boolean;
};

const workspaceDir = process.env.PLASTIC_WORKSPACE_DIR ?? process.cwd();
const plasticDir = join(workspaceDir, ".plastic");
const eventPath = join(plasticDir, "events", "events.jsonl");
const bundledExtensionsDir = join(workspaceDir, "apps", "desktop", "extensions", "bundled");
const runtimeHost = process.env.PLASTIC_RUNTIME_HOST ?? "0.0.0.0";
const runtimePort = Number(process.env.PLASTIC_RUNTIME_PORT ?? 7331);
const runtimeRpcUrl = process.env.PLASTIC_RPC_URL ?? `http://127.0.0.1:${runtimePort}/rpc`;
const startedAt = new Date().toISOString();

mkdirSync(join(plasticDir, "events"), { recursive: true });

const runPromise = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);
const eventStore = await createJsonlEventStore(eventPath);
const methods = createMethodRegistry();
const eventStreamClients = new Set<ServerResponse>();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

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

const selectEvents = (events: PlasticEvent[], input: EventListInput = {}) => {
  const typeSet = input.types ? new Set(input.types) : null;
  const selected = events.filter((event) => !typeSet || typeSet.has(event.type));
  if (input.limit === "all") {
    return selected;
  }
  return selected.slice(-Math.max(1, Math.min(input.limit ?? 500, 5_000)));
};

const buildChatMessagesForPanel = (events: PlasticEvent[], input: ChatMessagesInput = {}) => {
  const chatId = input.chatId ?? "chat-main";
  const limit = Math.max(1, Math.min(input.limit ?? 80, 500));
  const messages: ChatMessageProjection[] = [];

  events.forEach((event) => {
    const payload = asRecord(event.payload);
    if ((event.type === "chat.user_message.injected" || event.type === "chat.user_message.submitted") && asString(payload.chatId) === chatId) {
      messages.push({
        id: `message:${chatId}:${event.id}`,
        eventId: event.id,
        timestamp: event.timestamp,
        role: "user",
        content: asString(payload.content) ?? "",
        streaming: false
      });
    }

    if (event.type === "panel.message.sent" && asString(payload.toPanelId) === chatId) {
      messages.push({
        id: `message:${chatId}:${event.id}`,
        eventId: event.id,
        timestamp: event.timestamp,
        role: "peer",
        content: `${asString(payload.fromPanelId) ?? "panel"}: ${asString(payload.content) ?? ""}`,
        streaming: false
      });
    }

    if (event.type === "chat.agent_message.completed" && asString(payload.chatId) === chatId) {
      messages.push({
        id: `message:${chatId}:${event.id}`,
        eventId: event.id,
        timestamp: event.timestamp,
        role: "agent",
        content: asString(payload.content) ?? "",
        streaming: false
      });
    }
  });

  return messages.slice(-limit);
};

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
    owner: { kind: "runtime", id: "plastic.runtime" },
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
    id: "chats/messages",
    title: "Chat messages",
    owner: { kind: "extension", id: "plastic.chat" },
    handler: (input) => Effect.map(eventStore.list(), (events) => buildChatMessagesForPanel(events, input as ChatMessagesInput | undefined))
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

  await runPromise(methods.register({
    id: "chats/createCodexChat",
    title: "Create headless chat",
    owner: { kind: "extension", id: "plastic.chat" },
    handler: () => Effect.promise(async () => {
      const id = `chat-${crypto.randomUUID().slice(0, 8)}`;
      const panels = projectPanels(await runPromise(eventStore.list()));
      await appendEvent(eventStore, {
        type: "panel.created",
        payload: {
          id,
          title: `Chat ${panels.filter((panel) => panel.kind === "chat").length + 1}`,
          kind: "chat",
          extensionId: "plastic.chat",
          rendererId: "plastic.chat.chat-panel",
          subtitle: "Headless conversation surface",
          order: panels.length + 1
        },
        scope: { panelId: id, extensionId: "plastic.chat" }
      });
      return { panelId: id, chatId: id };
    })
  }));

  await runPromise(methods.register({
    id: "chats/close",
    title: "Close chat",
    owner: { kind: "extension", id: "plastic.chat" },
    handler: (input) => Effect.promise(async () => {
      const id = (input as { chatId?: string }).chatId;
      if (!id) {
        throw new Error("chats/close requires chatId");
      }
      return appendEvent(eventStore, {
        type: "panel.removed",
        payload: { id },
        scope: { panelId: id }
      });
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
