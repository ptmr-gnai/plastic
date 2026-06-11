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

export const bridgeConfigurePlasticMcpMetadata = {
  inputSchema: noInputSchema,
  examples: [
    {
      title: "Configure the Plastic MCP bridge",
      input: {},
      expectedEvents: ["bridge.plastic_mcp.configured"],
      verifyWith: { method: "bridge/status", input: {} }
    }
  ],
  effects: {
    durableEvents: ["bridge.plastic_mcp.configured"],
    mutatesProjection: ["codexBridge"]
  },
  reversibility: {
    reversible: false,
    notes: "Bridge configuration mutates Codex MCP config; compensate by editing or reconfiguring Codex MCP settings."
  }
};

export const bridgeStatusMetadata = {
  inputSchema: noInputSchema,
  examples: [
    {
      title: "Read Plastic bridge status",
      input: {},
      verifyWith: { method: "codex/status", input: {} }
    }
  ],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

export const bridgeTestMetadata = {
  inputSchema: noInputSchema,
  examples: [
    {
      title: "Test whether Codex can see the Plastic MCP tool",
      input: {},
      expectedEvents: ["bridge.plastic_mcp.tested"],
      verifyWith: { method: "bridge/status", input: {} }
    }
  ],
  effects: {
    durableEvents: ["bridge.plastic_mcp.tested"],
    mutatesProjection: ["codexBridge"]
  },
  reversibility: {
    reversible: false,
    notes: "Bridge test results are durable observations; compensate by appending a later test result."
  }
};

export const bridgeCallPlasticRpcToolMetadata = {
  inputSchema: {
    type: "object",
    required: ["method"],
    properties: {
      threadId: { type: "string", description: "Optional Codex thread id to use for the MCP tool call." },
      method: { type: "string", description: "Plastic RPC method to call through the plastic_rpc MCP tool." },
      input: { type: "object", description: "Plastic RPC input payload." }
    }
  },
  examples: [
    {
      title: "Call Plastic state through the MCP bridge",
      input: { method: "plastic/state", input: {} },
      expectedEvents: ["bridge.plastic_rpc_tool.called"],
      verifyWith: { method: "events/timeline", input: { scope: { agentId: "codex" } } }
    }
  ],
  effects: {
    durableEvents: ["bridge.plastic_rpc_tool.called"],
    mutatesProjection: ["codexBridge"]
  },
  reversibility: {
    reversible: false,
    notes: "The delegated Plastic RPC method may have its own effects; inspect that method metadata before calling."
  }
};

export const codexAliasMetadata = (codexMethod: string) => ({
  inputSchema: {
    type: "object",
    properties: {
      threadId: { type: "string", description: "Codex thread id, when required by the target method." },
      turnId: { type: "string", description: "Codex turn id, when required by the target method." },
      input: { type: "array", description: "Codex turn input items, when starting or steering a turn." },
      cwd: { type: "string", description: "Working directory, when starting a thread." },
      limit: { type: "number", description: "Optional result limit for list/read methods." }
    },
    additionalProperties: true
  },
  examples: [
    {
      title: `Call Codex ${codexMethod}`,
      input: {},
      verifyWith: { method: "codex/status", input: {} }
    }
  ],
  effects: {
    durableEvents: [],
    mutatesProjection: []
  },
  reversibility: {
    reversible: false,
    notes: "Codex alias effects depend on the delegated Codex app-server method."
  }
});
