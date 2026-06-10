import { type MethodRegistry } from "@plastic/core";
import { type Effect } from "effect";
import type { CodexRpcMessage, PendingRequest } from "./codex-adapter.js";

type MessageHandlerInput = {
  pending: Map<number, PendingRequest>;
  methods: MethodRegistry;
  runPromise: <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;
  appendCodexEvent: (type: string, payload: unknown) => Promise<unknown>;
  appendChatAgentEvent: (type: string, payload: Record<string, unknown>) => void;
  respondToServerRequest: (id: number, result: unknown) => void;
  rejectServerRequest: (id: number, error: unknown) => void;
  asRecord: (value: unknown) => Record<string, unknown>;
  asString: (value: unknown) => string | undefined;
};

const notificationEventType = (method: string) => {
  const known: Record<string, string> = {
    "thread/started": "codex.thread.started",
    "thread/status/changed": "codex.thread.status_changed",
    "thread/archived": "codex.thread.archived",
    "thread/unarchived": "codex.thread.unarchived",
    "thread/closed": "codex.thread.closed",
    "thread/name/updated": "codex.thread.name_updated",
    "thread/tokenUsage/updated": "codex.thread.token_usage_updated",
    "turn/started": "codex.turn.started",
    "turn/completed": "codex.turn.completed",
    "turn/diff/updated": "codex.turn.diff_updated",
    "turn/plan/updated": "codex.turn.plan_updated",
    "item/started": "codex.item.started",
    "item/completed": "codex.item.completed",
    "item/agentMessage/delta": "codex.item.agent_message_delta",
    "item/commandExecution/outputDelta": "codex.item.command_output_delta",
    "item/reasoning/summaryTextDelta": "codex.item.reasoning_summary_delta",
    "serverRequest/resolved": "codex.server_request.resolved"
  };
  return known[method] ?? `codex.${method.replaceAll("/", ".")}`;
};

const mapNotificationToChat = (input: MessageHandlerInput, method: string, params: unknown) => {
  const payload = input.asRecord(params);
  if (method === "item/agentMessage/delta") {
    input.appendChatAgentEvent("chat.agent_message.delta", {
      threadId: payload.threadId,
      turnId: payload.turnId,
      itemId: payload.itemId,
      delta: payload.delta
    });
    return;
  }

  if (method === "item/completed") {
    const item = input.asRecord(payload.item);
    if (item.type === "agentMessage") {
      input.appendChatAgentEvent("chat.agent_message.completed", {
        threadId: payload.threadId,
        turnId: payload.turnId,
        itemId: item.id ?? payload.itemId,
        content: item.text
      });
    }
    return;
  }

  if (method === "turn/completed") {
    const turn = input.asRecord(payload.turn);
    input.appendChatAgentEvent("chat.codex_turn.completed", {
      threadId: turn.threadId ?? payload.threadId,
      turnId: turn.id ?? payload.turnId,
      status: turn.status,
      error: turn.error
    });
  }
};

const handleServerToolRequest = (input: MessageHandlerInput, message: CodexRpcMessage) => {
  const requestId = message.id;
  if (typeof requestId !== "number") {
    return false;
  }
  if (message.method !== "item/tool/call") {
    input.rejectServerRequest(requestId, new Error(`Unsupported server request: ${message.method}`));
    return true;
  }

  void (async () => {
    try {
      const params = input.asRecord(message.params);
      const namespace = input.asString(params.namespace);
      const tool = input.asString(params.tool);
      if (!((namespace === undefined && tool === "plastic_rpc") || (namespace === "plastic" && tool === "rpc"))) {
        throw new Error(`Unsupported dynamic tool: ${namespace ? `${namespace}.` : ""}${tool ?? "unknown"}`);
      }

      const args = input.asRecord(params.arguments);
      const method = input.asString(args.method);
      if (!method) {
        throw new Error("plastic_rpc requires arguments.method");
      }

      const value = await input.runPromise(input.methods.call(method, args.input));
      const result = {
        contentItems: [
          {
            type: "inputText",
            text: JSON.stringify({ ok: true, value })
          }
        ],
        success: true
      };
      await input.appendCodexEvent("codex.server_request.responded", {
        id: requestId,
        method: message.method,
        tool: `${namespace}.${tool}`,
        rpcMethod: method,
        result
      });
      input.respondToServerRequest(requestId, result);
    } catch (error) {
      const result = {
        contentItems: [
          {
            type: "inputText",
            text: JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        ],
        success: false
      };
      await input.appendCodexEvent("codex.server_request.responded", {
        id: requestId,
        method: message.method,
        result
      });
      input.respondToServerRequest(requestId, result);
    }
  })();
  return true;
};

export const createCodexMessageHandler = (input: MessageHandlerInput) => (message: CodexRpcMessage) => {
  if (typeof message.id === "number" && input.pending.has(message.id)) {
    const requestState = input.pending.get(message.id);
    input.pending.delete(message.id);
    if (!requestState) {
      return;
    }
    if (message.error) {
      void input.appendCodexEvent("codex.request.failed", {
        id: message.id,
        method: requestState.method,
        params: requestState.params,
        error: message.error,
        sentEventId: requestState.sentEventId
      });
      requestState.reject(new Error(JSON.stringify(message.error)));
    } else {
      void input.appendCodexEvent("codex.response.received", {
        id: message.id,
        method: requestState.method,
        result: message.result,
        sentEventId: requestState.sentEventId
      });
      requestState.resolve(message.result);
    }
    return;
  }

  if (typeof message.id === "number" && message.method) {
    void input.appendCodexEvent("codex.server_request.received", {
      id: message.id,
      method: message.method,
      params: message.params
    });
    handleServerToolRequest(input, message);
    return;
  }

  if (message.method) {
    void input.appendCodexEvent("codex.notification.received", {
      method: message.method,
      params: message.params
    });
    void input.appendCodexEvent(notificationEventType(message.method), message.params ?? {});
    mapNotificationToChat(input, message.method, message.params);
  }
};
