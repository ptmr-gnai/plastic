import { Effect } from "effect";
import { projectPanels } from "@plastic/core";
import {
  availabilityFromCapabilities,
  type RuntimeMethodContext,
  type RuntimeModule
} from "./runtime-method-context.js";

type ChatInput = {
  chatId?: string;
  content?: string;
};

type CreateChatInput = {
  id?: string;
  title?: string;
  order?: number;
};

type UnavailableMethodDefinition = {
  id: string;
  title: string;
  description?: string;
};

const unavailableCodexMethods: UnavailableMethodDefinition[] = [
  { id: "codex/defaults", title: "Get Codex defaults" },
  { id: "codex/setDefaults", title: "Set Codex defaults" },
  { id: "codex/connect", title: "Connect Codex app-server" },
  { id: "codex/initialize", title: "Initialize Codex app-server" },
  { id: "codex/request", title: "Raw Codex request" },
  { id: "codex/threadStart", title: "Start Codex thread" },
  { id: "codex/threadResume", title: "Resume Codex thread" },
  { id: "codex/threadFork", title: "Fork Codex thread" },
  { id: "codex/threadList", title: "List Codex threads" },
  { id: "codex/threadRead", title: "Read Codex thread" },
  { id: "codex/threadArchive", title: "Archive Codex thread" },
  { id: "codex/threadNameSet", title: "Set Codex thread name" },
  { id: "codex/turnStart", title: "Start Codex turn" },
  { id: "codex/turnSteer", title: "Steer active Codex turn" },
  { id: "codex/turnInterrupt", title: "Interrupt Codex turn" },
  { id: "codex/modelList", title: "List Codex models" },
  { id: "codex/configRead", title: "Read Codex config" },
  { id: "chats/bindCodexThread", title: "Bind chat to Codex thread" },
  { id: "chats/startCodexThread", title: "Start chat Codex thread" },
  { id: "chats/interrupt", title: "Interrupt chat turn" },
  { id: "chats/close", title: "Close chat backend" }
];

export const agentBackendFallbackModule: RuntimeModule = {
  id: "agent-backend-fallback",
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
      description: "Returns Codex backend availability for this Plastic host.",
      owner: { kind: "runtime", id: "plastic.agent-backend" },
      availability,
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
      description: "Returns the current agent backend binding for a chat panel.",
      owner: { kind: "runtime", id: "plastic.agent-backend" },
      availability,
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
      description: "Creates a chat panel; Codex thread creation is unavailable without an agent.codex capability.",
      owner: { kind: "runtime", id: "plastic.agent-backend" },
      availability,
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
    scope: { panelId, extensionId: "plastic.chat" }
  });
  const noticeEvent = await context.appendEvent({
    type: "chat.agent_message.completed",
    payload: {
      chatId: panelId,
      itemId: `headless-${crypto.randomUUID().slice(0, 8)}`,
      content: "Chat created. Codex app-server passthrough is unavailable in this host."
    },
    scope: { panelId },
    causationId: panelEvent.id
  });
  return { panelId, chatId: panelId, threadId: null, panelEvent, noticeEvent, availability };
};

const registerSendToCodex = async (context: RuntimeMethodContext, availability: CodexAvailability) => {
  await context.runPromise(
    context.methods.register({
      id: "chats/sendToCodex",
      title: "Send chat message to Codex",
      description: "Records a chat message; Codex turn start is unavailable without an agent.codex capability.",
      owner: { kind: "runtime", id: "plastic.agent-backend" },
      availability,
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
        owner: { kind: "runtime", id: "plastic.agent-backend" },
        availability,
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
    actor: { kind: "user", id: "local-user", name: "Local User" }
  });
  const agentEvent = await context.appendEvent({
    type: "chat.agent_message.completed",
    payload: {
      chatId,
      itemId: `headless-${crypto.randomUUID().slice(0, 8)}`,
      content: "Headless runtime received this message. Codex app-server passthrough is unavailable in this host."
    },
    scope: { panelId: chatId },
    causationId: userEvent.id
  });
  return { userEvent, agentEvent, availability };
};
