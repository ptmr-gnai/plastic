import { Effect } from "effect";
import { projectPanels, type PlasticEventMeta } from "@plastic/core";
import {
  availabilityFromCapabilities,
  type RuntimeMethodContext,
  type RuntimeModule
} from "./runtime-method-context.js";
import {
  chatBindingMetadata,
  createCodexChatMetadata,
  sendToCodexMetadata
} from "./chat-method-metadata.js";
import {
  bridgeCallPlasticRpcToolMetadata,
  bridgeConfigurePlasticMcpMetadata,
  bridgeStatusMetadata,
  bridgeTestMetadata,
  codexAliasMetadata,
  codexDefaultsMetadata,
  codexRequestMetadata,
  codexSetDefaultsMetadata,
  codexStatusMetadata
} from "./codex-backend-method-metadata.js";
import { codexBackendOwner } from "./codex-method-registration.js";

type ChatInput = {
  chatId?: string;
  content?: string;
  meta?: PlasticEventMeta;
};

type CreateChatInput = {
  id?: string;
  title?: string;
  order?: number;
  meta?: PlasticEventMeta;
};

type UnavailableMethodDefinition = {
  id: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

const unavailableCodexMethods: UnavailableMethodDefinition[] = [
  {
    id: "codex/defaults",
    title: "Get Codex defaults",
    description: "Returns Plastic's durable Codex adapter defaults used for new chat threads and turns.",
    metadata: codexDefaultsMetadata
  },
  {
    id: "codex/setDefaults",
    title: "Set Codex defaults",
    description: "Durably updates Plastic's Codex adapter defaults.",
    metadata: codexSetDefaultsMetadata
  },
  { id: "codex/connect", title: "Connect Codex app-server", description: "Connects to the Codex app-server process." },
  { id: "codex/initialize", title: "Initialize Codex app-server", description: "Initializes the Codex app-server session." },
  {
    id: "codex/request",
    title: "Raw Codex request",
    description: "Passthrough to any Codex app-server method. Params and result are preserved as-is.",
    metadata: codexRequestMetadata
  },
  { id: "codex/threadStart", title: "Start Codex thread", metadata: codexAliasMetadata("thread/start") },
  { id: "codex/threadResume", title: "Resume Codex thread", metadata: codexAliasMetadata("thread/resume") },
  { id: "codex/threadFork", title: "Fork Codex thread", metadata: codexAliasMetadata("thread/fork") },
  { id: "codex/threadList", title: "List Codex threads", metadata: codexAliasMetadata("thread/list") },
  { id: "codex/threadRead", title: "Read Codex thread", metadata: codexAliasMetadata("thread/read") },
  { id: "codex/threadArchive", title: "Archive Codex thread", metadata: codexAliasMetadata("thread/archive") },
  { id: "codex/threadNameSet", title: "Set Codex thread name", metadata: codexAliasMetadata("thread/name/set") },
  { id: "codex/turnStart", title: "Start Codex turn", metadata: codexAliasMetadata("turn/start") },
  { id: "codex/turnSteer", title: "Steer active Codex turn", metadata: codexAliasMetadata("turn/steer") },
  { id: "codex/turnInterrupt", title: "Interrupt Codex turn", metadata: codexAliasMetadata("turn/interrupt") },
  { id: "codex/modelList", title: "List Codex models", metadata: codexAliasMetadata("model/list") },
  { id: "codex/configRead", title: "Read Codex config", metadata: codexAliasMetadata("config/read") },
  {
    id: "bridge/configurePlasticMcp",
    title: "Configure Plastic MCP bridge",
    description: "Registers the plastic_rpc MCP tool with Codex app-server and reloads MCP config.",
    metadata: bridgeConfigurePlasticMcpMetadata
  },
  {
    id: "bridge/status",
    title: "Plastic bridge status",
    description: "Returns Codex MCP bridge configuration and discovered MCP tool status.",
    metadata: bridgeStatusMetadata
  },
  {
    id: "bridge/test",
    title: "Test Plastic MCP bridge",
    description: "Checks that Codex sees the plastic MCP server and plastic_rpc tool.",
    metadata: bridgeTestMetadata
  },
  {
    id: "bridge/callPlasticRpcTool",
    title: "Call Plastic RPC through MCP",
    description: "Calls the plastic_rpc MCP tool through Codex app-server to prove the agent tool path works.",
    metadata: bridgeCallPlasticRpcToolMetadata
  },
  {
    id: "chats/bindCodexThread",
    title: "Bind chat to Codex thread",
    description: "Durably binds a chat panel to an existing Codex thread id."
  },
  {
    id: "chats/startCodexThread",
    title: "Start chat Codex thread",
    description: "Starts a Codex thread through native thread/start and binds it to a chat panel."
  },
  {
    id: "chats/interrupt",
    title: "Interrupt chat turn",
    description: "Interrupts the active Codex turn bound to a chat panel."
  },
  {
    id: "chats/close",
    title: "Close chat",
    description: "Closes a chat panel and interrupts any in-progress Codex turn before removing it."
  }
];

export const agentBackendFallbackModule: RuntimeModule = {
  id: "agent-backend",
  register: async (context) => {
    const codexAvailability = availabilityFromCapabilities(
      context.capabilities,
      ["agent.codex"],
      "Codex app-server passthrough is not attached in this host."
    );
    await registerCodexStatus(context, codexAvailability);
    await registerChatBinding(context, codexAvailability);
    await registerCreateChat(context, codexAvailability);
    await registerSendToCodex(context, codexAvailability);
    await registerUnavailableCodexMethods(context, codexAvailability);
  }
};

type CodexAvailability = ReturnType<typeof availabilityFromCapabilities>;

const registerCodexStatus = async (context: RuntimeMethodContext, availability: CodexAvailability) => {
  await context.runPromise(
    context.methods.register({
      id: "codex/status",
      title: "Codex status",
      owner: codexBackendOwner,
      availability,
      ...codexStatusMetadata,
      handler: () => Effect.succeed({
        connected: false,
        initialized: false,
        pid: null,
        pendingRequests: 0,
        availability
      })
    })
  );
};

const registerChatBinding = async (context: RuntimeMethodContext, availability: CodexAvailability) => {
  await context.runPromise(
    context.methods.register({
      id: "chats/getBinding",
      title: "Get chat backend binding",
      description: "Returns the current Codex thread binding and active turn state for a chat panel.",
      owner: codexBackendOwner,
      availability,
      ...chatBindingMetadata,
      handler: (input) => Effect.succeed({
        chatId: (input as { chatId?: string } | undefined)?.chatId ?? "chat-main",
        runtimeId: "headless",
        threadId: null,
        activeTurnId: null,
        activeTurnStatus: null,
        availability
      })
    })
  );
};

const registerCreateChat = async (context: RuntimeMethodContext, availability: CodexAvailability) => {
  await context.runPromise(
    context.methods.register({
      id: "chats/createCodexChat",
      title: "Create Codex chat",
      description: "Creates a new chat panel, starts a fresh Codex thread, and binds them.",
      owner: codexBackendOwner,
      availability,
      ...createCodexChatMetadata,
      handler: (input) => Effect.promise(() => createFallbackChat(context, input, availability))
    })
  );
};

const createFallbackChat = async (context: RuntimeMethodContext, input: unknown, availability: CodexAvailability) => {
  const payload = input as CreateChatInput | undefined;
  const events = await context.runPromise(context.eventStore.list());
  const panels = projectPanels(events);
  const chatCount = panels.filter((panel) => panel.kind === "chat").length;
  const panelId = payload?.id ?? `chat-${crypto.randomUUID().slice(0, 8)}`;
  const title = payload?.title ?? `Chat ${chatCount + 1}`;
  const order = payload?.order ?? Math.max(0, ...panels.map((panel) => panel.order)) + 1;
  const panelEvent = await context.appendEvent({
    type: "panel.created",
    payload: {
      id: panelId,
      title,
      kind: "chat",
      extensionId: "plastic.chat",
      rendererId: "plastic.chat.chat-panel",
      subtitle: "Markdown conversation surface",
      body: "Chat panel created without an attached Codex backend.",
      order
    },
    scope: { panelId, extensionId: "plastic.chat" },
    ...(payload?.meta ? { meta: payload.meta } : {})
  });
  const noticeEvent = await context.appendEvent({
    type: "chat.agent_message.completed",
    payload: {
      chatId: panelId,
      itemId: `headless-${crypto.randomUUID().slice(0, 8)}`,
      content: "Chat created. Codex app-server passthrough is unavailable in this host."
    },
    scope: { panelId },
    causationId: panelEvent.id,
    ...(payload?.meta ? { meta: payload.meta } : {})
  });
  return { panelId, chatId: panelId, threadId: null, panelEvent, noticeEvent, availability };
};

const registerSendToCodex = async (context: RuntimeMethodContext, availability: CodexAvailability) => {
  await context.runPromise(
    context.methods.register({
      id: "chats/sendToCodex",
      title: "Send chat message to Codex",
      description: "Durably records a user message, binds the chat to a Codex thread, and starts a Codex turn.",
      owner: codexBackendOwner,
      availability,
      ...sendToCodexMetadata,
      handler: (input) => Effect.promise(() => recordFallbackMessage(context, input, availability))
    })
  );
};

const registerUnavailableCodexMethods = async (context: RuntimeMethodContext, availability: CodexAvailability) => {
  for (const definition of unavailableCodexMethods) {
    await context.runPromise(
      context.methods.register({
        id: definition.id,
        title: definition.title,
        description: definition.description ?? "Codex app-server passthrough is unavailable in this host.",
        owner: codexBackendOwner,
        availability,
        ...(definition.metadata ?? {}),
        handler: () => Effect.promise(async () => {
          throw new Error(`${definition.id} is unavailable: missing agent.codex capability`);
        })
      })
    );
  }
};

const recordFallbackMessage = async (context: RuntimeMethodContext, input: unknown, availability: CodexAvailability) => {
  const payload = input as ChatInput | undefined;
  const chatId = payload?.chatId ?? "chat-main";
  const content = payload?.content?.trim();
  if (!content) {
    throw new Error("chats/sendToCodex requires content");
  }
  const userEvent = await context.appendEvent({
    type: "chat.user_message.submitted",
    payload: { chatId, content, targetAgent: "codex" },
    scope: { panelId: chatId, agentId: "codex" },
    actor: { kind: "user", id: "local-user", name: "Local User" },
    ...(payload?.meta ? { meta: payload.meta } : {})
  });
  const agentEvent = await context.appendEvent({
    type: "chat.agent_message.completed",
    payload: {
      chatId,
      itemId: `headless-${crypto.randomUUID().slice(0, 8)}`,
      content: "Headless runtime received this message. Codex app-server passthrough is unavailable in this host."
    },
    scope: { panelId: chatId },
    causationId: userEvent.id,
    ...(payload?.meta ? { meta: payload.meta } : {})
  });
  return { userEvent, agentEvent, availability };
};
