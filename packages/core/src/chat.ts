import type { PlasticEvent } from "./events.js";

export type ChatMessagesInput = {
  chatId?: string;
  limit?: number;
};

export type ChatMessageProjection = {
  id: string;
  eventId: string;
  timestamp: string;
  content: string;
  role: "user" | "agent" | "system" | "peer";
  streaming: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const buildChatMessagesForPanel = (events: PlasticEvent[], input: ChatMessagesInput = {}) => {
  const chatId = input.chatId ?? "chat-main";
  const limit = Math.max(1, Math.min(input.limit ?? 80, 500));
  const completedAgentMessageIds = new Set<string>();
  const firstDeltaOrder = new Map<string, number>();

  events.forEach((event, index) => {
    const payload = asRecord(event.payload);
    if (asString(payload.chatId) !== chatId) {
      return;
    }

    if (event.type === "chat.agent_message.delta") {
      const itemId = asString(payload.itemId) ?? `agent:${event.id}`;
      if (!firstDeltaOrder.has(itemId)) {
        firstDeltaOrder.set(itemId, index);
      }
      return;
    }

    if (event.type === "chat.agent_message.completed") {
      completedAgentMessageIds.add(asString(payload.itemId) ?? `agent:${event.id}`);
    }
  });

  const messages: Array<ChatMessageProjection & { order: number }> = [];
  const agentMessages = new Map<string, ChatMessageProjection & { order: number }>();
  const pushMessage = (event: PlasticEvent, order: number, role: ChatMessageProjection["role"], content: string, streaming = false) => {
    messages.push({
      id: `message:${chatId}:${event.id}`,
      eventId: event.id,
      timestamp: event.timestamp,
      role,
      content,
      streaming,
      order
    });
  };
  const ensureAgentMessage = (event: PlasticEvent, itemId: string, order: number) => {
    let existing = agentMessages.get(itemId);
    if (!existing) {
      existing = {
        id: `message:${chatId}:${itemId}`,
        eventId: event.id,
        timestamp: event.timestamp,
        role: "agent",
        content: "",
        streaming: false,
        order
      };
      agentMessages.set(itemId, existing);
      messages.push(existing);
    }
    existing.order = Math.min(existing.order, order);
    return existing;
  };

  events.forEach((event, index) => {
    const payload = asRecord(event.payload);

    if ((event.type === "chat.user_message.injected" || event.type === "chat.user_message.submitted") && asString(payload.chatId) === chatId) {
      pushMessage(event, index, "user", asString(payload.content) ?? "");
      return;
    }

    if (event.type === "panel.message.sent" && asString(payload.toPanelId) === chatId) {
      pushMessage(event, index, "peer", `${asString(payload.fromPanelId) ?? "panel"}: ${asString(payload.content) ?? ""}`);
      return;
    }

    if (event.type === "chat.agent_message.delta" && asString(payload.chatId) === chatId) {
      const itemId = asString(payload.itemId) ?? `agent:${event.id}`;
      if (completedAgentMessageIds.has(itemId)) {
        return;
      }
      const existing = ensureAgentMessage(event, itemId, firstDeltaOrder.get(itemId) ?? index);
      existing.content += asString(payload.delta) ?? "";
      existing.streaming = true;
      return;
    }

    if (event.type === "chat.agent_message.completed" && asString(payload.chatId) === chatId) {
      const itemId = asString(payload.itemId) ?? `agent:${event.id}`;
      const existing = ensureAgentMessage(event, itemId, firstDeltaOrder.get(itemId) ?? index);
      existing.content = asString(payload.content) ?? existing.content;
      existing.streaming = false;
      return;
    }

    if (event.type === "chat.codex_turn.completed" && asString(payload.chatId) === chatId && asString(payload.status) === "failed") {
      const error = asRecord(payload.error);
      pushMessage(event, index, "system", asString(error.message) ?? "Codex turn failed.");
    }
  });

  return messages
    .sort((left, right) => left.order - right.order)
    .slice(-limit)
    .map(({ order: _order, ...message }) => message);
};
