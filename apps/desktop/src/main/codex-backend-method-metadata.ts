import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";

export const codexStatusMetadata = {
  description: "Returns Codex backend connection, initialization, and capability status for this Plastic host.",
  inputSchema: noInputSchema,
  examples: [
    {
      title: "Check Codex backend status",
      input: {},
      verifyWith: { method: "runtime/capabilities", input: {} }
    }
  ],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

export const codexDefaultsMetadata = {
  inputSchema: noInputSchema,
  examples: [
    {
      title: "Read Codex defaults",
      input: {},
      verifyWith: { method: "codex/status", input: {} }
    }
  ],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

export const codexSetDefaultsMetadata = {
  inputSchema: {
    type: "object",
    required: ["model"],
    properties: {
      model: { type: "string", description: "Default model id for new Codex-backed chats and turns." }
    }
  },
  examples: [
    {
      title: "Set the default Codex model",
      input: { model: "gpt-5-mini" },
      expectedEvents: ["codex.defaults.updated"],
      verifyWith: { method: "codex/defaults", input: {} }
    }
  ],
  effects: {
    durableEvents: ["codex.defaults.updated"],
    mutatesProjection: ["codexDefaults"]
  },
  reversibility: {
    reversible: false,
    notes: "Defaults are durable; compensate by setting the previous model again."
  }
};

export const codexRequestMetadata = {
  inputSchema: {
    type: "object",
    required: ["method"],
    properties: {
      method: { type: "string", description: "Codex app-server method name." },
      params: { type: "object", description: "Optional Codex app-server method params." }
    }
  },
  examples: [
    {
      title: "List Codex models through passthrough",
      input: { method: "model/list", params: {} },
      verifyWith: { method: "codex/status", input: {} }
    }
  ],
  effects: {
    durableEvents: [],
    mutatesProjection: []
  },
  reversibility: {
    reversible: false,
    notes: "Passthrough effects depend on the Codex app-server method being called."
  }
};
