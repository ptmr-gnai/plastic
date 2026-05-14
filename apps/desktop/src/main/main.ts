import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { Effect } from "effect";
import { createEvent, createJsonlEventStore, createMethodRegistry, buildPlasticState, type EventStore } from "@plastic/core";
import { ipcChannels, type RpcRequest, type RpcResponse } from "../shared/ipc.js";

const workspaceDir = process.env.PLASTIC_WORKSPACE_DIR ?? process.cwd();
const clayDir = join(workspaceDir, ".clay");
const eventPath = join(clayDir, "events", "events.jsonl");
mkdirSync(join(clayDir, "events"), { recursive: true });

const eventStore = await createJsonlEventStore(eventPath);
const methods = createMethodRegistry();
const windows = new Set<BrowserWindow>();

const runPromise = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

const registerRuntimeMethods = async (store: EventStore) => {
  await runPromise(
    methods.register({
      id: "plastic/state",
      title: "Plastic state",
      description: "Returns HATEOAS-style app state.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => buildPlasticState(store, methods)
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
      id: "events/list",
      title: "List events",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => store.list()
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
        Effect.promise(async () => {
          const windows = BrowserWindow.getAllWindows();
          const refs = [];
          for (const window of windows) {
            const windowRefs = await window.webContents.executeJavaScript(`
              [...document.querySelectorAll("[data-plastic-ref]")].map((element) => ({
                ref: element.dataset.plasticRef,
                panel: element.dataset.plasticPanel,
                extension: element.dataset.plasticExtension,
                command: element.dataset.plasticCommand,
                tag: element.tagName.toLowerCase(),
                text: (element.innerText || element.textContent || "").slice(0, 240)
              }))
            `) as unknown[];
            refs.push({ windowId: window.id, refs: windowRefs });
          }
          return refs;
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

  server.listen(7331, "127.0.0.1");
  return server;
};

const startBuildSocket = () => {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      sendJson(response, 200, { ok: true, service: "plastic.build" });
      return;
    }

    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, {
        ok: true,
        value: {
          service: "plastic.build",
          status: "stubbed",
          viteUrl: process.env.VITE_DEV_SERVER_URL ?? null
        }
      });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  });

  server.listen(7332, "127.0.0.1");
  return server;
};

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Plastic",
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
        payload: { electronWindowId: window.id }
      })
    )
  );

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(new URL("../../dist/index.html", import.meta.url).pathname);
  }
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

await registerRuntimeMethods(eventStore);
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
