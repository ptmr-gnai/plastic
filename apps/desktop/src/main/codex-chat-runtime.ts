import { Effect } from "effect";
import { createEvent, type EventStore, type PlasticEvent } from "@plastic/core";

type RunPromise = <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;

type CodexDefaults = {
  model: string;
};

type ChatRuntimeInput = {
  eventStore: EventStore;
  runPromise: RunPromise;
  workspaceDir: string | undefined;
  runtimeRpcUrl: string;
  runtimeRpcUrls: string[];
  getCodexDefaults: () => Promise<CodexDefaults>;
  request: (method: string, params?: unknown) => Promise<unknown>;
  asRecord: (value: unknown) => Record<string, unknown>;
  asString: (value: unknown) => string | undefined;
};

const developerInstructions = (input: {
  chatId: string;
  runtimeRpcUrl: string;
  runtimeRpcUrls: string[];
}) => [
  "You are an agent embodied inside Plastic, an agent-native Electron workspace.",
  `Your current chat panel id is ${input.chatId}.`,
  `Plastic RPC is the control bus. Preferred endpoint: ${input.runtimeRpcUrl}.`,
  `Fallback endpoints: ${input.runtimeRpcUrls.join(", ")}.`,
  "You have an MCP tool named plastic_rpc. Prefer that tool for Plastic RPC calls because command sandboxes may not open local TCP sockets.",
  "plastic_rpc input is { method: string, input?: object }. It returns the exact Plastic RPC result as JSON text.",
  "Use the HTTP bus for app control only if plastic_rpc is unavailable. Do not assume 127.0.0.1 works; use PLASTIC_RPC_URL or the preferred endpoint first.",
  `Before mutating the app or answering orientation questions, call plastic_rpc with method agent/orient and input {"panelId":${JSON.stringify(input.chatId)}}.`,
  "Use the returned eventCursor on later agent/orient or events/timeline calls to learn what changed since you last looked.",
  "After mutating Plastic, verify with the orientation packet's recommended actions, visible refs, screenshots, timeline, or build/typecheck methods.",
  "Call plastic/state before guessing panel ids. It returns panels, methods, links, actions, windows, visible refs, and event counts.",
  "RPC shape: POST the JSON object {\"method\":\"plastic/state\",\"input\":{}} to the bus URL with content-type application/json.",
  "To create another chat, call method chats/createCodexChat. To send a mailbox message between panels, call panels/sendMessage. To make another chat agent react, call chats/sendToCodex for that target chat.",
  "Everything meaningful should go through Plastic RPC and the durable event stream."
].join("\n");

const activeTurnForChat = (input: {
  events: PlasticEvent[];
  chatId: string;
  asRecord: (value: unknown) => Record<string, unknown>;
  asString: (value: unknown) => string | undefined;
}) => {
  let activeTurnId: string | null = null;
  let activeTurnStatus: string | null = null;
  for (const event of input.events) {
    if (event.scope.panelId !== input.chatId) {
      continue;
    }
    const payload = input.asRecord(event.payload);
    if (event.type === "chat.codex_turn.started") {
      const turn = input.asRecord(payload.turn);
      activeTurnId = input.asString(turn.id) ?? activeTurnId;
      activeTurnStatus = input.asString(turn.status) ?? "inProgress";
    }
    if (event.type === "chat.codex_turn.completed") {
      activeTurnId = input.asString(payload.turnId) ?? activeTurnId;
      activeTurnStatus = input.asString(payload.status) ?? "completed";
    }
    if (event.type === "chat.turn.interrupted") {
      activeTurnId = input.asString(payload.turnId) ?? activeTurnId;
      activeTurnStatus = "interrupted";
    }
  }
  return { activeTurnId, activeTurnStatus };
};

const threadStartPayload = (reason: string, cwd?: string) => {
  const payload: { reason: string; cwd?: string } = { reason };
  if (cwd) {
    payload.cwd = cwd;
  }
  return payload;
};

export const createCodexChatRuntime = (input: ChatRuntimeInput) => {
  const threadChatBindings = new Map<string, string>();

  const appendChatAgentEvent = (type: string, payload: Record<string, unknown>) => {
    const threadId = input.asString(payload.threadId);
    const chatId = threadId ? threadChatBindings.get(threadId) : undefined;
    if (!chatId) {
      return;
    }

    void input.runPromise(
      input.eventStore.append(
        createEvent({
          type,
          payload: {
            chatId,
            ...payload
          },
          scope: {
            panelId: chatId,
            agentId: "codex"
          },
          actor: {
            kind: "agent",
            id: "codex",
            name: "Codex"
          }
        })
      )
    );
  };

  const bindThreadToChat = async (chatId: string, threadId: string, reason: string) => {
    for (const [existingThreadId, existingChatId] of threadChatBindings.entries()) {
      if (existingChatId === chatId && existingThreadId !== threadId) {
        threadChatBindings.delete(existingThreadId);
      }
    }
    threadChatBindings.set(threadId, chatId);
    await input.runPromise(
      input.eventStore.append(
        createEvent({
          type: "chat.codex_thread.bound",
          payload: {
            chatId,
            threadId,
            reason
          },
          scope: {
            panelId: chatId,
            agentId: "codex"
          }
        })
      )
    );
  };

  const getBoundThreadId = async (chatId: string): Promise<string | undefined> => {
    for (const [threadId, boundChatId] of threadChatBindings.entries()) {
      if (boundChatId === chatId) {
        return threadId;
      }
    }

    const events = await input.runPromise(input.eventStore.list());
    const binding = events
      .filter((event) => event.type === "chat.codex_thread.bound")
      .map((event) => input.asRecord(event.payload))
      .filter((payload) => payload.chatId === chatId)
      .at(-1);
    const threadId = input.asString(binding?.threadId);
    if (threadId) {
      threadChatBindings.set(threadId, chatId);
    }
    return threadId;
  };

  const getChatBinding = async (chatId: string) => {
    const threadId = await getBoundThreadId(chatId);
    const events = await input.runPromise(input.eventStore.list());
    const { activeTurnId, activeTurnStatus } = activeTurnForChat({ events, chatId, asRecord: input.asRecord, asString: input.asString });
    return {
      chatId,
      runtimeId: "codex",
      threadId: threadId ?? null,
      activeTurnId,
      activeTurnStatus
    };
  };

  const developerInstructionsForChat = (chatId: string) =>
    developerInstructions({ chatId, runtimeRpcUrl: input.runtimeRpcUrl, runtimeRpcUrls: input.runtimeRpcUrls });

  const startThreadForChat = async (chatId: string, payload: {
    cwd?: string;
    reason: string;
  }) => {
    const defaults = await input.getCodexDefaults();
    const threadResult = await input.request("thread/start", {
      cwd: payload.cwd ?? input.workspaceDir,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      model: defaults.model,
      personality: "friendly",
      serviceName: "plastic",
      developerInstructions: developerInstructionsForChat(chatId)
    });
    const thread = input.asRecord(input.asRecord(threadResult).thread);
    const threadId = input.asString(thread.id);
    if (!threadId) {
      throw new Error("Codex thread/start did not return thread.id");
    }
    await bindThreadToChat(chatId, threadId, payload.reason);
    return { threadId, threadResult };
  };

  const chatIdForThread = (threadId: string) => threadChatBindings.get(threadId);

  return {
    bindThreadToChat,
    appendChatAgentEvent,
    developerInstructionsForChat,
    getBoundThreadId,
    getChatBinding,
    startThreadForChat,
    threadStartPayload
  };
};
