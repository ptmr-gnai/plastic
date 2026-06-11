import { readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";

export const chatIdInputSchema = {
  type: "object",
  properties: {
    chatId: { type: "string", description: "Chat panel id. Defaults to chat-main." }
  }
};

export const createCodexChatInputSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Optional panel id for the new chat." },
    title: { type: "string", description: "Optional panel title." },
    cwd: { type: "string", description: "Optional working directory for the Codex thread." },
    order: { type: "number", description: "Optional panel order." },
    params: { type: "object", description: "Optional native Codex thread/start params." }
  }
};

export const fallbackCreateCodexChatInputSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Optional panel id for the new chat." },
    title: { type: "string", description: "Optional panel title." },
    order: { type: "number", description: "Optional panel order." }
  }
};

export const sendToCodexInputSchema = {
  type: "object",
  required: ["content"],
  properties: {
    chatId: { type: "string", description: "Chat panel id. Defaults to chat-main." },
    content: { type: "string", description: "User message content to submit." },
    cwd: { type: "string", description: "Optional working directory when a thread must be started." },
    model: { type: "string", description: "Optional model override for this turn." },
    effort: { type: "string", description: "Optional reasoning effort override for this turn." }
  }
};

export const fallbackSendToCodexInputSchema = {
  type: "object",
  required: ["content"],
  properties: {
    chatId: { type: "string", description: "Chat panel id. Defaults to chat-main." },
    content: { type: "string", description: "User message content to record." }
  }
};

export const chatBindingMetadata = {
  inputSchema: chatIdInputSchema,
  examples: [
    {
      title: "Inspect a chat binding",
      input: { chatId: "chat-main" },
      verifyWith: { method: "events/timeline", input: { scope: { panelId: "chat-main" } } }
    }
  ],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

export const createCodexChatMetadata = {
  inputSchema: createCodexChatInputSchema,
  examples: [
    {
      title: "Create a named chat panel",
      input: { title: "Research Chat" },
      expectedEvents: ["panel.created", "chat.codex_thread.bound"],
      verifyWith: { method: "panels/list", input: {} }
    }
  ],
  effects: {
    durableEvents: ["panel.created", "chat.codex_thread.bound"],
    mutatesProjection: ["panels", "chatBindings"]
  },
  reversibility: {
    reversible: false,
    notes: "Chat/backend actions are durable; compensate with follow-up events or explicit close/interrupt methods."
  }
};

export const fallbackCreateCodexChatMetadata = {
  inputSchema: fallbackCreateCodexChatInputSchema,
  examples: [
    {
      title: "Create a fallback chat panel",
      input: { title: "Headless Chat" },
      expectedEvents: ["panel.created", "chat.agent_message.completed"],
      verifyWith: { method: "panels/list", input: {} }
    }
  ],
  effects: {
    durableEvents: ["panel.created", "chat.agent_message.completed"],
    mutatesProjection: ["panels", "chats"]
  },
  reversibility: {
    reversible: false,
    notes: "Chat actions are durable; compensate with follow-up events or explicit close/interrupt methods."
  }
};

export const sendToCodexMetadata = {
  inputSchema: sendToCodexInputSchema,
  examples: [
    {
      title: "Send a user message",
      input: { chatId: "chat-main", content: "Summarize the current Plastic state." },
      expectedEvents: ["chat.user_message.submitted", "chat.codex_turn.started"],
      verifyWith: { method: "events/timeline", input: { scope: { panelId: "chat-main" } } }
    }
  ],
  effects: {
    durableEvents: ["chat.user_message.submitted", "chat.codex_turn.started"],
    mutatesProjection: ["chats", "chatBindings"]
  },
  reversibility: {
    reversible: false,
    notes: "Chat/backend actions are durable; compensate with follow-up events or explicit close/interrupt methods."
  }
};

export const fallbackSendToCodexMetadata = {
  inputSchema: fallbackSendToCodexInputSchema,
  examples: [
    {
      title: "Record a fallback chat message",
      input: { chatId: "chat-main", content: "Hello from headless." },
      expectedEvents: ["chat.user_message.submitted", "chat.agent_message.completed"],
      verifyWith: { method: "events/timeline", input: { scope: { panelId: "chat-main" } } }
    }
  ],
  effects: {
    durableEvents: ["chat.user_message.submitted", "chat.agent_message.completed"],
    mutatesProjection: ["chats"]
  },
  reversibility: {
    reversible: false,
    notes: "Chat actions are durable; compensate with follow-up events or explicit close/interrupt methods."
  }
};
