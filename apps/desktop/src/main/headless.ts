import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import {
  buildTimeline,
  groupMethodsByOwner,
  projectExtensions,
  projectPanels,
  projectWindows,
  type EventStore
} from "@plastic/core";
import { activateExtensions } from "./extension-host.js";
import { registerExtensionMethods, scanBundledExtensions, scanWorkspaceExtensions } from "./extension-loader.js";
import { headlessCapabilityModule } from "./headless-capability-methods.js";
import { panelControlModule } from "./panel-control-methods.js";
import { panelMailboxModule } from "./panel-methods.js";
import { startRuntimeHttpTransport } from "./runtime-http-transport.js";
import { runtimeControlModule } from "./runtime-control-methods.js";
import { createRuntimeHealthModule } from "./runtime-health-methods.js";
import { createPlasticRuntime } from "./runtime-kernel.js";
import { createRuntimeSnapshotModule } from "./runtime-snapshot-methods.js";
import { createRuntimeStateModule } from "./runtime-state-methods.js";
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
const runtimeCapabilities = [
  { id: "runtime.capabilities", title: "Runtime capability registry", status: "available" as const },
  { id: "window.projection", title: "Window projection", status: "available" as const },
  { id: "event.projection", title: "Event projection", status: "available" as const },
  { id: "electron.window", title: "Electron windows", status: "unavailable" as const, notes: "Headless mode has no Electron BrowserWindow host." },
  { id: "dom.refs", title: "DOM visible refs", status: "unavailable" as const, notes: "Headless mode has no rendered DOM projection." },
  { id: "dom.eval", title: "DOM evaluation", status: "unavailable" as const, notes: "Headless mode has no renderer DOM." },
  { id: "dom.input", title: "DOM input control", status: "unavailable" as const, notes: "Headless mode has no rendered input elements." },
  { id: "screenshot", title: "Window screenshot capture", status: "unavailable" as const, notes: "Headless mode has no screenshot provider." }
];

const execFileAsync = promisify(execFile);
const runtime = await createPlasticRuntime({ workspaceDir, eventPath, capabilities: runtimeCapabilities });
const { eventStore, methods, runPromise } = runtime;

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

const appendEvent = async (_store: EventStore, eventInput: Parameters<typeof runtime.appendEvent>[0]) =>
  runtime.appendEvent(eventInput);

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
const runtimeStateModule = createRuntimeStateModule({
  decorateState: (state) => ({
    ...state,
    app: { ...state.app, mode: "headless" },
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
  })
});
const runtimeHealthModule = createRuntimeHealthModule();
const runtimeSnapshotModule = createRuntimeSnapshotModule({
  getHostDetails: () => ({
    app: { name: "Plastic", mode: "headless", workspaceDir, eventPath },
    build: buildStatus(),
    runtime: { windowCount: 0 },
    codex: { connected: false, initialized: false, pid: null, pendingRequests: 0 },
    visibleRefs: []
  })
});
await runtime.registerModules([
  runtimeStateModule,
  runtimeSnapshotModule,
  runtimeControlModule,
  panelControlModule,
  headlessCapabilityModule,
  runtimeHealthModule
]);
await registerExtensionMethods({ workspaceDir, eventStore, methods, runPromise });
await activateExtensions({ workspaceDir, eventStore, methods, runPromise });
await runtime.registerModules([panelMailboxModule]);
await appendEvent(eventStore, {
  type: "runtime.started",
  payload: { mode: "headless" }
});

const runtimeTransport = await startRuntimeHttpTransport({
  eventStore,
  methods,
  runPromise,
  host: runtimeHost,
  port: runtimePort,
  onListening: () => {
    console.log(`[plastic:headless] RPC listening at ${runtimeRpcUrl}`);
  }
});

process.on("SIGINT", () => {
  runtimeTransport.close();
  process.exit(130);
});

process.on("SIGTERM", () => {
  runtimeTransport.close();
  process.exit(143);
});
