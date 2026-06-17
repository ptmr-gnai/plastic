import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";

const codexStatusOutputSchema = {
  type: "object",
  required: ["connected", "initialized", "pid", "pendingRequests"],
  properties: {
    connected: { type: "boolean" },
    initialized: { type: "boolean" },
    pid: { type: ["number", "null"] },
    connectedAt: { type: ["string", "null"] },
    pendingRequests: { type: "number" },
    availability: { type: "object" }
  }
};

const codexDefaultsOutputSchema = {
  type: "object",
  required: ["model"],
  properties: {
    model: { type: "string" }
  }
};

const codexSetDefaultsOutputSchema = {
  type: "object",
  required: ["defaults", "eventId"],
  properties: {
    defaults: codexDefaultsOutputSchema,
    eventId: { type: "string" }
  }
};

const codexConnectOutputSchema = {
  type: "object",
  required: ["connected", "initialized", "pid", "connectedAt"],
  properties: {
    connected: { type: "boolean" },
    initialized: { type: "boolean" },
    pid: { type: ["number", "null"] },
    connectedAt: { type: ["string", "null"] }
  }
};

const bridgeConfigurePlasticMcpOutputSchema = {
  type: "object",
  required: ["configured", "value", "writeResult", "reloadResult"],
  properties: {
    configured: { type: "boolean" },
    value: { type: "object" },
    writeResult: {},
    reloadResult: {}
  }
};

const bridgeStatusOutputSchema = {
  type: "object",
  required: ["plasticMcpConfigured", "plasticMcpLastError", "plasticMcpServerPath", "runtimeRpcUrl", "mcpStatus", "mcpError"],
  properties: {
    plasticMcpConfigured: { type: "boolean" },
    plasticMcpLastError: { type: ["string", "null"] },
    plasticMcpServerPath: { type: "string" },
    runtimeRpcUrl: { type: "string" },
    mcpStatus: {},
    mcpError: { type: ["string", "null"] }
  }
};

const bridgeTestOutputSchema = {
  type: "object",
  required: ["ok", "status", "eventId"],
  properties: {
    ok: { type: "boolean" },
    status: {},
    eventId: { type: "string" }
  }
};

const bridgeCallPlasticRpcToolOutputSchema = {
  type: "object",
  required: ["threadId", "result", "eventId"],
  properties: {
    threadId: { type: "string" },
    result: {},
    eventId: { type: "string" }
  }
};

const codexPassthroughOutputSchema = {
  description: "Raw result returned by the delegated Codex app-server method."
};

export const codexStatusMetadata = {
  description: "Returns Codex backend connection, initialization, and capability status for this Plastic host.",
  inputSchema: noInputSchema,
  outputSchema: codexStatusOutputSchema,
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
  description: "Returns Plastic's durable Codex adapter defaults used for new chat threads and turns.",
  inputSchema: noInputSchema,
  outputSchema: codexDefaultsOutputSchema,
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
  description: "Durably updates Plastic's Codex adapter defaults.",
  inputSchema: {
    type: "object",
    required: ["model"],
    properties: {
      model: { type: "string", description: "Default model id for new Codex-backed chats and turns." }
    }
  },
  outputSchema: codexSetDefaultsOutputSchema,
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

export const codexConnectMetadata = {
  description: "Connects to the Codex app-server process for this Plastic host.",
  inputSchema: {
    type: "object",
    properties: {
      codexPath: { type: "string", description: "Optional Codex executable path or command." }
    }
  },
  outputSchema: codexConnectOutputSchema,
  examples: [
    {
      title: "Connect Codex app-server",
      input: {},
      expectedEvents: ["codex.connection.started"],
      verifyWith: { method: "codex/status", input: {} }
    }
  ],
  effects: {
    durableEvents: ["codex.connection.started"],
    mutatesProjection: ["codexBackend"]
  },
  reversibility: {
    reversible: false,
    notes: "Connection process lifetime is host state; restart Plastic or let the process exit to reset it."
  }
};

export const codexInitializeMetadata = {
  description: "Initializes the Codex app-server session and configures Plastic MCP integration.",
  inputSchema: noInputSchema,
  outputSchema: codexPassthroughOutputSchema,
  examples: [
    {
      title: "Initialize Codex app-server",
      input: {},
      expectedEvents: ["codex.connection.initialized", "bridge.plastic_mcp.configured"],
      verifyWith: { method: "codex/status", input: {} }
    }
  ],
  effects: {
    durableEvents: ["codex.connection.initialized", "bridge.plastic_mcp.configured"],
    mutatesProjection: ["codexBackend", "codexBridge"]
  },
  reversibility: {
    reversible: false,
    notes: "Initialization changes host process state and Codex MCP config."
  }
};

export const codexRequestMetadata = {
  description: "Passthrough to any Codex app-server method. Params and result are preserved as-is.",
  inputSchema: {
    type: "object",
    required: ["method"],
    properties: {
      method: { type: "string", description: "Codex app-server method name." },
      params: { type: "object", description: "Optional Codex app-server method params." }
    }
  },
  outputSchema: codexPassthroughOutputSchema,
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
  description: "Registers the plastic_rpc MCP tool with Codex app-server and reloads MCP config.",
  inputSchema: noInputSchema,
  outputSchema: bridgeConfigurePlasticMcpOutputSchema,
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
  description: "Returns Codex MCP bridge configuration and discovered MCP tool status.",
  inputSchema: noInputSchema,
  outputSchema: bridgeStatusOutputSchema,
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
  description: "Checks that Codex sees the plastic MCP server and plastic_rpc tool.",
  inputSchema: noInputSchema,
  outputSchema: bridgeTestOutputSchema,
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
  description: "Calls the plastic_rpc MCP tool through Codex app-server to prove the agent tool path works. Tool results include delegated method effects and reversibility when available. Agents should use agent/orient or agent/workbench for orientation and runtime/auditStatus for headed/headless audit state.",
  inputSchema: {
    type: "object",
    required: ["method"],
    properties: {
      threadId: { type: "string", description: "Optional Codex thread id to use for the MCP tool call." },
      method: { type: "string", description: "Plastic RPC method to call through the plastic_rpc MCP tool." },
      input: { type: "object", description: "Plastic RPC input payload." }
    }
  },
  outputSchema: bridgeCallPlasticRpcToolOutputSchema,
  examples: [
    {
      title: "Orient through the MCP bridge",
      input: { method: "agent/orient", input: {} },
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
  description: `Passthrough to Codex app-server ${codexMethod}.`,
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
  outputSchema: codexPassthroughOutputSchema,
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
