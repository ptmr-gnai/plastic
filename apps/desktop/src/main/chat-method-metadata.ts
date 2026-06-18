import { readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import { plasticEventSchema } from "./runtime-control-schemas.js";

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

const chatBindingOutputSchema = {
  type: "object",
  required: ["chatId", "runtimeId", "threadId", "activeTurnId", "activeTurnStatus"],
  properties: {
    chatId: { type: "string" },
    runtimeId: { type: "string" },
    threadId: { type: ["string", "null"] },
    activeTurnId: { type: ["string", "null"] },
    activeTurnStatus: { type: ["string", "null"] },
    availability: { type: "object" }
  }
};

const createCodexChatOutputSchema = {
  type: "object",
  required: ["panelId", "chatId", "threadId", "panelEvent"],
  properties: {
    panelId: { type: "string" },
    chatId: { type: "string" },
    threadId: { type: ["string", "null"] },
    panelEvent: plasticEventSchema,
    noticeEvent: plasticEventSchema,
    thread: {},
    availability: { type: "object" }
  }
};

const sendToCodexOutputSchema = {
  type: "object",
  properties: {
    chatId: { type: "string" },
    threadId: { type: ["string", "null"] },
    userMessage: plasticEventSchema,
    userEvent: plasticEventSchema,
    agentEvent: plasticEventSchema,
    turn: {},
    availability: { type: "object" }
  }
};

const startCodexThreadOutputSchema = {
  type: "object",
  required: ["chatId", "threadId", "thread"],
  properties: {
    chatId: { type: "string" },
    threadId: { type: "string" },
    thread: {}
  }
};

const closeChatOutputSchema = {
  type: "object",
  required: ["chatId", "binding", "interrupted", "interruptResult", "closedEvent", "panelEvent"],
  properties: {
    chatId: { type: "string" },
    binding: chatBindingOutputSchema,
    interrupted: { type: "boolean" },
    interruptResult: {},
    closedEvent: plasticEventSchema,
    panelEvent: plasticEventSchema
  }
};

export const chatBindingMetadata = {
  inputSchema: chatIdInputSchema,
  outputSchema: chatBindingOutputSchema,
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

export const bindCodexThreadMetadata = {
  inputSchema: {
    type: "object",
    required: ["threadId"],
    properties: {
      chatId: { type: "string", description: "Chat panel id. Defaults to chat-main." },
      threadId: { type: "string", description: "Existing Codex thread id to bind." },
      reason: { type: "string", description: "Optional reason stored with the binding event." }
    }
  },
  outputSchema: chatBindingOutputSchema,
  examples: [{ title: "Bind a chat", input: { chatId: "chat-main", threadId: "thread-id" }, verifyWith: { method: "chats/getBinding", input: { chatId: "chat-main" } } }],
  effects: { durableEvents: ["chat.codex_thread.bound"], mutatesProjection: ["chatBindings"] },
  reversibility: { reversible: false, notes: "Bind another thread or close the chat to compensate." }
};

export const startCodexThreadMetadata = {
  inputSchema: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "Chat panel id. Defaults to chat-main." },
      cwd: { type: "string", description: "Optional Codex thread working directory." },
      params: { type: "object", description: "Optional native Codex thread/start params." }
    }
  },
  outputSchema: startCodexThreadOutputSchema,
  examples: [{ title: "Start and bind a chat thread", input: { chatId: "chat-main" }, verifyWith: { method: "chats/getBinding", input: { chatId: "chat-main" } } }],
  effects: { durableEvents: ["chat.codex_thread.bound"], mutatesProjection: ["chatBindings"] },
  reversibility: { reversible: false, notes: "Close the chat or bind another thread to compensate." }
};

export const createCodexChatMetadata = {
  inputSchema: createCodexChatInputSchema,
  outputSchema: createCodexChatOutputSchema,
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
  outputSchema: createCodexChatOutputSchema,
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

export const interruptChatMetadata = {
  inputSchema: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "Chat panel id. Defaults to chat-main." },
      turnId: { type: "string", description: "Optional turn id. Defaults to the active bound turn." }
    }
  },
  outputSchema: { description: "Codex turn/interrupt passthrough result." },
  examples: [{ title: "Interrupt active chat turn", input: { chatId: "chat-main" }, verifyWith: { method: "events/timeline", input: { scope: { panelId: "chat-main" } } } }],
  effects: { durableEvents: ["chat.turn.interrupted"], mutatesProjection: ["chats", "chatBindings"] },
  reversibility: { reversible: false, notes: "Interrupted turns cannot be resumed through Plastic." }
};

export const closeChatMetadata = {
  inputSchema: {
    type: "object",
    properties: {
      chatId: { type: "string", description: "Chat panel id. Defaults to chat-main." },
      reason: { type: "string", description: "Optional close reason." }
    }
  },
  outputSchema: closeChatOutputSchema,
  examples: [{ title: "Close a chat", input: { chatId: "chat-main" }, verifyWith: { method: "panels/list", input: {} } }],
  effects: { durableEvents: ["chat.session.closed", "panel.removed"], mutatesProjection: ["panels", "chats", "chatBindings"] },
  reversibility: { reversible: false, notes: "Recreate the chat or replay the event log to recover it." }
};

export const sendToCodexMetadata = {
  inputSchema: sendToCodexInputSchema,
  outputSchema: sendToCodexOutputSchema,
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
  outputSchema: sendToCodexOutputSchema,
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
