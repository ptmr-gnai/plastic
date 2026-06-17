import { Effect } from "effect";
import { createEvent, projectPanels, type EventStore, type MethodRegistry } from "@plastic/core";
import type { RunPromise } from "./runtime-method-context.js";
import { codexBackendAvailability, codexBackendOwner } from "./codex-method-registration.js";
import {
  bindCodexThreadMetadata,
  chatBindingMetadata,
  closeChatMetadata,
  createCodexChatMetadata,
  interruptChatMetadata,
  sendToCodexMetadata,
  startCodexThreadMetadata
} from "./chat-method-metadata.js";

type ChatBinding = {
  chatId: string;
  threadId: string | null;
  activeTurnId: string | null;
  activeTurnStatus: string | null;
  [key: string]: unknown;
};

type ThreadStartPayload = {
  reason: string;
  cwd?: string;
};

type CodexChatRegistrationInput = {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  workspaceDir: string;
  getCodexDefaults: () => Promise<{ model: string }>;
  bindThreadToChat: (chatId: string, threadId: string, reason: string) => Promise<void>;
  getBoundThreadId: (chatId: string) => Promise<string | undefined>;
  getChatBinding: (chatId: string) => Promise<ChatBinding>;
  startThreadForChat: (chatId: string, payload: ThreadStartPayload) => Promise<{ threadId: string; threadResult: unknown }>;
  threadStartPayload: (reason: string, cwd?: string) => ThreadStartPayload;
  developerInstructionsForChat: (chatId: string) => string;
  ensureInitialized: () => Promise<void>;
  request: (method: string, params?: unknown) => Promise<unknown>;
  isThreadNotFoundError: (error: unknown) => boolean;
  asRecord: (value: unknown) => Record<string, unknown>;
  asString: (value: unknown) => string | undefined;
};

export const registerCodexChatMethods = async (input: CodexChatRegistrationInput) => {
  await registerChatBinding(input);
  await registerBindCodexThread(input);
  await registerStartCodexThread(input);
  await registerCreateCodexChat(input);
  await registerInterruptChat(input);
  await registerCloseChat(input);
  await registerSendToCodex(input);
};

const registerChatBinding = async (input: CodexChatRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "chats/getBinding",
      title: "Get chat backend binding",
      description: "Returns the current Codex thread binding and active turn state for a chat panel.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...chatBindingMetadata,
      handler: (methodInput) =>
        Effect.promise(async () => {
          const chatId = (methodInput as { chatId?: string } | undefined)?.chatId ?? "chat-main";
          return input.getChatBinding(chatId);
        })
    })
  );
};

const registerBindCodexThread = async (input: CodexChatRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "chats/bindCodexThread",
      title: "Bind chat to Codex thread",
      description: "Durably binds a chat panel to an existing Codex thread id.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...bindCodexThreadMetadata,
      handler: (methodInput) =>
        Effect.promise(async () => {
          const payload = methodInput as { chatId?: string; threadId?: string; reason?: string };
          const chatId = payload.chatId ?? "chat-main";
          if (!payload.threadId) {
            throw new Error("chats/bindCodexThread requires threadId");
          }
          await input.bindThreadToChat(chatId, payload.threadId, payload.reason ?? "manual bind");
          return input.getChatBinding(chatId);
        })
    })
  );
};

const registerStartCodexThread = async (input: CodexChatRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "chats/startCodexThread",
      title: "Start chat Codex thread",
      description: "Starts a Codex thread through native thread/start and binds it to a chat panel.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...startCodexThreadMetadata,
      handler: (methodInput) =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          const payload = methodInput as { chatId?: string; cwd?: string; params?: Record<string, unknown> };
          const chatId = payload.chatId ?? "chat-main";
          const defaults = await input.getCodexDefaults();
          const threadResult = await input.request("thread/start", {
            cwd: payload.cwd ?? input.workspaceDir,
            approvalPolicy: "never",
            sandbox: "danger-full-access",
            model: defaults.model,
            personality: "friendly",
            serviceName: "plastic",
            developerInstructions: input.developerInstructionsForChat(chatId),
            ...payload.params
          });
          const thread = input.asRecord(input.asRecord(threadResult).thread);
          const threadId = input.asString(thread.id);
          if (!threadId) {
            throw new Error("Codex thread/start did not return thread.id");
          }
          await input.bindThreadToChat(chatId, threadId, "chats/startCodexThread");
          return {
            chatId,
            threadId,
            thread: input.asRecord(threadResult).thread ?? threadResult
          };
        })
    })
  );
};

const registerCreateCodexChat = async (input: CodexChatRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "chats/createCodexChat",
      title: "Create Codex chat",
      description: "Creates a new chat panel, starts a fresh Codex thread, and binds them.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...createCodexChatMetadata,
      handler: (methodInput) => Effect.promise(() => createCodexChat(input, methodInput))
    })
  );
};

const createCodexChat = async (input: CodexChatRegistrationInput, methodInput: unknown) => {
  await input.ensureInitialized();
  const payload = methodInput as {
    id?: string;
    title?: string;
    cwd?: string;
    order?: number;
    params?: Record<string, unknown>;
  };
  const events = await input.runPromise(input.eventStore.list());
  const panels = projectPanels(events);
  const chatCount = panels.filter((panel) => panel.kind === "chat").length;
  const panelId = payload.id ?? `chat-${crypto.randomUUID().slice(0, 8)}`;
  const title = payload.title ?? `Chat ${chatCount + 1}`;
  const order = payload.order ?? Math.max(0, ...panels.map((panel) => panel.order)) + 1;
  const defaults = await input.getCodexDefaults();
  const threadResult = await input.request("thread/start", {
    cwd: payload.cwd ?? input.workspaceDir,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    model: defaults.model,
    personality: "friendly",
    serviceName: "plastic",
    developerInstructions: input.developerInstructionsForChat(panelId),
    ...payload.params
  });
  const thread = input.asRecord(input.asRecord(threadResult).thread);
  const threadId = input.asString(thread.id);
  if (!threadId) {
    throw new Error("Codex thread/start did not return thread.id");
  }

  const panelEvent = await input.runPromise(
    input.eventStore.append(
      createEvent({
        type: "panel.created",
        payload: {
          id: panelId,
          title,
          kind: "chat",
          extensionId: "plastic.chat",
          rendererId: "plastic.chat.chat-panel",
          subtitle: "Markdown conversation surface",
          body: "Fresh Codex chat created through chats/createCodexChat.",
          order
        },
        scope: {
          panelId,
          extensionId: "plastic.chat"
        }
      })
    )
  );
  await input.bindThreadToChat(panelId, threadId, "chats/createCodexChat");
  return {
    panelId,
    chatId: panelId,
    threadId,
    panelEvent,
    thread: input.asRecord(threadResult).thread ?? threadResult
  };
};

const registerInterruptChat = async (input: CodexChatRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "chats/interrupt",
      title: "Interrupt chat turn",
      description: "Interrupts the active Codex turn bound to a chat panel.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...interruptChatMetadata,
      handler: (methodInput) =>
        Effect.promise(async () => {
          await input.ensureInitialized();
          const payload = methodInput as { chatId?: string; turnId?: string };
          const binding = await input.getChatBinding(payload.chatId ?? "chat-main");
          const turnId = payload.turnId ?? binding.activeTurnId;
          if (!binding.threadId || !turnId || binding.activeTurnStatus !== "inProgress") {
            throw new Error("chats/interrupt requires a bound thread with an active in-progress turn");
          }
          const result = await input.request("turn/interrupt", {
            threadId: binding.threadId,
            turnId
          });
          await input.runPromise(
            input.eventStore.append(
              createEvent({
                type: "chat.turn.interrupted",
                payload: {
                  chatId: binding.chatId,
                  threadId: binding.threadId,
                  turnId,
                  result
                },
                scope: {
                  panelId: binding.chatId,
                  agentId: "codex"
                }
              })
            )
          );
          return result;
        })
    })
  );
};

const registerCloseChat = async (input: CodexChatRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "chats/close",
      title: "Close chat",
      description: "Closes a chat panel and interrupts any in-progress Codex turn before removing it.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...closeChatMetadata,
      handler: (methodInput) => Effect.promise(() => closeChat(input, methodInput))
    })
  );
};

const closeChat = async (input: CodexChatRegistrationInput, methodInput: unknown) => {
  const payload = methodInput as { chatId?: string; reason?: string };
  const chatId = payload.chatId ?? "chat-main";
  const binding = await input.getChatBinding(chatId);
  let interruptResult: unknown = null;
  if (binding.threadId && binding.activeTurnId && binding.activeTurnStatus === "inProgress") {
    await input.ensureInitialized();
    interruptResult = await input.request("turn/interrupt", {
      threadId: binding.threadId,
      turnId: binding.activeTurnId
    });
  }

  const closedEvent = await input.runPromise(
    input.eventStore.append(
      createEvent({
        type: "chat.session.closed",
        payload: {
          chatId,
          threadId: binding.threadId,
          activeTurnId: binding.activeTurnId,
          activeTurnStatus: binding.activeTurnStatus,
          interrupted: Boolean(interruptResult),
          reason: payload.reason ?? "closed"
        },
        scope: {
          panelId: chatId,
          agentId: "codex"
        }
      })
    )
  );

  const panelEvent = await input.runPromise(
    input.eventStore.append(
      createEvent({
        type: "panel.removed",
        payload: {
          id: chatId,
          reason: payload.reason ?? "chat closed"
        },
        scope: { panelId: chatId }
      })
    )
  );

  return {
    chatId,
    binding,
    interrupted: Boolean(interruptResult),
    interruptResult,
    closedEvent,
    panelEvent
  };
};

const registerSendToCodex = async (input: CodexChatRegistrationInput) => {
  await input.runPromise(
    input.methods.register({
      id: "chats/sendToCodex",
      title: "Send chat message to Codex",
      description: "Durably records a user message, binds the chat to a Codex thread, and starts a Codex turn.",
      owner: codexBackendOwner,
      availability: codexBackendAvailability,
      ...sendToCodexMetadata,
      handler: (methodInput) => Effect.promise(() => sendToCodex(input, methodInput))
    })
  );
};

const sendToCodex = async (input: CodexChatRegistrationInput, methodInput: unknown) => {
  await input.ensureInitialized();
  const payload = methodInput as {
    chatId?: string;
    content?: string;
    cwd?: string;
    model?: string;
    effort?: string;
  };
  const chatId = payload.chatId ?? "chat-main";
  const content = payload.content?.trim();
  if (!content) {
    throw new Error("chats/sendToCodex requires content");
  }

  const userMessage = await input.runPromise(
    input.eventStore.append(
      createEvent({
        type: "chat.user_message.submitted",
        payload: {
          chatId,
          content,
          targetAgent: "codex"
        },
        scope: {
          panelId: chatId,
          agentId: "codex"
        },
        actor: {
          kind: "user",
          id: "local-user",
          name: "Local User"
        }
      })
    )
  );

  const turnResult = await startTurnForMessage(input, payload, chatId, content, userMessage.id);
  return {
    chatId,
    threadId: turnResult.threadId,
    userMessage,
    turn: input.asRecord(turnResult.turnResult).turn ?? turnResult.turnResult
  };
};

const startTurnForMessage = async (
  input: CodexChatRegistrationInput,
  payload: { cwd?: string; model?: string; effort?: string },
  chatId: string,
  content: string,
  userMessageId: string
) => {
  let threadId = await input.getBoundThreadId(chatId);
  let threadResult: unknown = null;
  if (!threadId) {
    const started = await input.startThreadForChat(chatId, input.threadStartPayload("chats/sendToCodex", payload.cwd));
    threadId = started.threadId;
    threadResult = started.threadResult;
  }
  const defaults = await input.getCodexDefaults();
  const turnInput = {
    threadId,
    input: [{ type: "text", text: content }],
    model: payload.model ?? defaults.model,
    ...(payload.effort ? { effort: payload.effort } : {})
  };
  let turnResult = await startTurnWithStaleThreadRecovery(input, payload.cwd, chatId, threadId, turnInput);
  threadId = turnResult.threadId;
  threadResult = turnResult.threadResult ?? threadResult;
  await recordTurnStarted(input, chatId, threadId, userMessageId, turnResult.turnResult, threadResult);
  return turnResult;
};

const startTurnWithStaleThreadRecovery = async (
  input: CodexChatRegistrationInput,
  cwd: string | undefined,
  chatId: string,
  threadId: string,
  turnInput: Record<string, unknown>
) => {
  try {
    return {
      threadId,
      threadResult: null,
      turnResult: await input.request("turn/start", turnInput)
    };
  } catch (error) {
    if (!input.isThreadNotFoundError(error)) {
      throw error;
    }
    await input.runPromise(
      input.eventStore.append(
        createEvent({
          type: "chat.codex_thread.stale",
          payload: {
            chatId,
            threadId,
            error: error instanceof Error ? error.message : String(error)
          },
          scope: {
            panelId: chatId,
            agentId: "codex"
          }
        })
      )
    );
    const started = await input.startThreadForChat(chatId, input.threadStartPayload("stale thread rebind", cwd));
    return {
      threadId: started.threadId,
      threadResult: started.threadResult,
      turnResult: await input.request("turn/start", {
        ...turnInput,
        threadId: started.threadId
      })
    };
  }
};

const recordTurnStarted = async (
  input: CodexChatRegistrationInput,
  chatId: string,
  threadId: string,
  userMessageId: string,
  turnResult: unknown,
  threadResult: unknown
) => {
  await input.runPromise(
    input.eventStore.append(
      createEvent({
        type: "chat.codex_turn.started",
        payload: {
          chatId,
          threadId,
          userMessageId,
          turn: input.asRecord(turnResult).turn ?? turnResult,
          thread: threadResult ? input.asRecord(threadResult).thread ?? threadResult : null
        },
        scope: {
          panelId: chatId,
          agentId: "codex"
        }
      })
    )
  );
};
