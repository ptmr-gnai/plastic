import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, type Rectangle } from "electron";
import { Effect } from "effect";
import { createEvent, createJsonlEventStore, createMethodRegistry, buildPlasticState, projectExtensions, projectPanels, projectWindows, type EventStore, type PlasticEvent } from "@plastic/core";
import { ipcChannels, type RpcRequest, type RpcResponse } from "../shared/ipc.js";
import { createCodexAdapter } from "./codex-adapter.js";
import { registerExtensionMethods, scanWorkspaceExtensions } from "./extension-loader.js";
import { registerPanelMailboxMethods } from "./panel-methods.js";

const workspaceDir = process.env.PLASTIC_WORKSPACE_DIR ?? process.cwd();
const clayDir = join(workspaceDir, ".clay");
const eventPath = join(clayDir, "events", "events.jsonl");
mkdirSync(join(clayDir, "events"), { recursive: true });

const runPromise = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

const eventStore = await createJsonlEventStore(eventPath);
const methods = createMethodRegistry();
const codexAdapter = createCodexAdapter({ eventStore, methods, runPromise, workspaceDir });
const windows = new Set<BrowserWindow>();
const eventStreamClients = new Set<ServerResponse>();
const processStartedAt = new Date().toISOString();

type VisibleRef = {
  ref?: string;
  panel?: string;
  extension?: string;
  command?: string;
  tag: string;
  text: string;
};

type WindowVisibleRefs = {
  windowId: number;
  refs: VisibleRef[];
};

type ScreenshotInput = {
  windowId?: number;
  ref?: string;
};

const buildStatus = () => ({
  service: "plastic.build",
  status: "running",
  workspaceDir,
  clayDir,
  extensionsDir: join(clayDir, "extensions"),
  eventPath,
  viteUrl: process.env.VITE_DEV_SERVER_URL ?? null,
  runtimeSocket: "http://127.0.0.1:7331",
  buildSocket: "http://127.0.0.1:7332",
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
        text: (element.innerText || element.textContent || "").slice(0, 240)
      }))
    `) as VisibleRef[];
    refs.push({ windowId: window.id, refs: windowRefs });
  }
  return refs;
};

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
      (() => {
        const ref = ${JSON.stringify(input.ref)};
        const element = [...document.querySelectorAll("[data-plastic-ref]")]
          .find((candidate) => candidate.dataset.plasticRef === ref);
        if (!element) {
          return null;
        }
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
    hints.add(".clay/extensions");
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

  for (const panel of bundledPanels) {
    if (existingPanelIds.has(panel.id)) {
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
            const found = await window.webContents.executeJavaScript(`
              (() => {
                const element = document.querySelector('[data-plastic-ref="${ref}"]');
                if (!element) return false;
                element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
                return true;
              })()
            `) as boolean;
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
            const found = await window.webContents.executeJavaScript(`
              (() => {
                const element = document.querySelector('[data-plastic-ref="${ref}"]');
                if (!element) return false;
                element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
                return true;
              })()
            `) as boolean;
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
          const panelId = visible?.ref.panel ?? (ref.startsWith("panel:") ? ref.slice("panel:".length) : undefined);
          const panel = panelId ? panels.find((candidate) => candidate.id === panelId) : undefined;
          const extensionId = visible?.ref.extension ?? panel?.extensionId;
          const extension = extensionId ? extensions.find((candidate) => candidate.id === extensionId) : undefined;
          const command = visible?.ref.command;
          const lineage = findRecentEvents(
            events,
            (event) =>
              event.scope.panelId === panelId ||
              event.scope.extensionId === extensionId ||
              event.type.includes(panelId ?? "__no_panel__") ||
              event.type.includes(extensionId ?? "__no_extension__"),
            12
          );

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
            visible,
            panel,
            extension,
            command,
            sourceHints: sourceHintsFor(sourceHintInput),
            lineage,
            actions: [
              ...(panelId ? [
                { id: "get-panel", title: "Get panel", method: "panels/get", input: { id: panelId } },
                { id: "rename-panel", title: "Rename panel", method: "panels/rename" }
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

  server.listen(7331, "127.0.0.1");
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

  server.listen(7332, "127.0.0.1");
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
