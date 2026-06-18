import { stableJson } from "./plastic-stable-json.mjs";

let canonicalAgentTransports = null;
let canonicalAgentTransportSource = null;

const inputSatisfiesRequiredFields = (input, schema) => {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  if (required.length === 0) {
    return input !== undefined;
  }
  if (!input || typeof input !== "object") {
    return false;
  }
  return required.every((key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined);
};

const assertHttpTransport = ({ assert, http, rpcUrl, source }) => {
  const methodsUrl = rpcUrl.replace(/\/rpc$/, "/methods");
  const selfTestUrl = rpcUrl.replace(/\/rpc$/, "/self-test");
  const eventStreamUrl = rpcUrl.replace(/\/rpc$/, "/events/stream");
  assert(http?.status === "available", `${source} missing available HTTP RPC transport`);
  assert(http.title === "HTTP RPC", `${source} HTTP transport title mismatch`);
  assert(http.transport === "http", `${source} HTTP transport kind mismatch`);
  assert(http.methodRegistry === "shared", `${source} HTTP transport must use shared registry`);
  assert(http.rpcUrl === rpcUrl, `${source} HTTP transport URL mismatch`);
  assert(http.links?.some((link) => link.rel === "methods" && link.method === "http/get" && link.href === methodsUrl), `${source} HTTP transport missing methods link`);
  assert(http.links?.some((link) => link.rel === "self-test" && link.method === "http/get" && link.href === selfTestUrl), `${source} HTTP transport missing self-test link`);
  assert(http.links?.some((link) => link.rel === "event-stream" && link.method === "http/get" && link.href === eventStreamUrl), `${source} HTTP transport missing event stream link`);
  assert(http.links?.some((link) => link.rel === "rpc" && link.method === "http/post" && link.href === rpcUrl), `${source} HTTP transport missing RPC link`);
  assert(http.actions?.some((action) => action.id === "call-plastic-rpc" && action.method === "http/post" && action.href === rpcUrl), `${source} HTTP transport missing call action`);
  assert(http.actions?.some((action) => action.id === "call-plastic-rpc" && action.inputSchema?.required?.includes("method")), `${source} HTTP transport call action missing RPC input schema`);
};

const assertMcpTransport = ({ assert, mcp, rpcUrl, source }) => {
  assert(mcp?.status === "available", `${source} missing available MCP stdio transport`);
  assert(mcp.title === "MCP stdio bridge", `${source} MCP transport title mismatch`);
  assert(mcp.transport === "stdio", `${source} MCP transport kind mismatch`);
  assert(mcp.methodRegistry === "shared", `${source} MCP transport must use shared registry`);
  assert(mcp.command === "node" && mcp.args?.includes("scripts/plastic-mcp-server.mjs"), `${source} MCP command mismatch`);
  assert(mcp.env?.PLASTIC_RPC_URL === rpcUrl, `${source} MCP RPC URL mismatch`);
  assert(mcp.tools?.some((tool) => tool.name === "plastic_rpc" && tool.methodRegistry === "shared"), `${source} MCP transport missing plastic_rpc tool metadata`);
  assert(mcp.tools?.some((tool) => tool.name === "plastic_rpc" && tool.inputSchema?.required?.includes("method")), `${source} MCP plastic_rpc tool missing RPC input schema`);
  assert(mcp.actions?.some((action) => action.id === "call-plastic-rpc" && action.tool === "plastic_rpc" && action.arguments?.method === "agent/orient"), `${source} MCP transport missing plastic_rpc call action`);
  assert(mcp.actions?.some((action) => action.id === "call-plastic-rpc" && action.inputSchema?.required?.includes("method")), `${source} MCP transport call action missing RPC input schema`);
};

const delegatedActionMethods = (items) =>
  items.flatMap((transport) =>
    (transport.actions ?? [])
      .map((action) => action.arguments?.method)
      .filter((method) => typeof method === "string")
  );

const assertDelegatedActions = ({ assert, items, methodsById, methodIds, source }) => {
  if (methodIds.size > 0) {
    const delegatedMethods = delegatedActionMethods(items);
    const unknownDelegatedMethods = delegatedMethods.filter((method) => !methodIds.has(method));
    assert(
      unknownDelegatedMethods.length === 0,
      `${source} agent transport actions reference unknown delegated methods: ${unknownDelegatedMethods.join(", ")}`
    );
    const unavailableDelegatedMethods = delegatedMethods.filter((method) => methodsById[method]?.availability?.status !== "available");
    assert(
      unavailableDelegatedMethods.length === 0,
      `${source} agent transport actions reference unavailable delegated methods: ${unavailableDelegatedMethods.join(", ")}`
    );
    const invalidDelegatedInputs = items.flatMap((transport) =>
      (transport.actions ?? [])
        .filter((action) => typeof action.arguments?.method === "string")
        .filter((action) => !inputSatisfiesRequiredFields(action.arguments.input, methodsById[action.arguments.method]?.inputSchema))
        .map((action) => `${transport.id}:${action.id}:${action.arguments.method}`)
    );
    assert(
      invalidDelegatedInputs.length === 0,
      `${source} agent transport actions have invalid delegated inputs: ${invalidDelegatedInputs.join(", ")}`
    );
  }
};

const assertTransportSchemas = ({ assert, http, mcp, rpcCallInputSchema, source }) => {
  if (rpcCallInputSchema) {
    const schemas = [
      { label: "HTTP call action", schema: http.actions?.find((action) => action.id === "call-plastic-rpc")?.inputSchema },
      { label: "MCP plastic_rpc tool", schema: mcp.tools?.find((tool) => tool.name === "plastic_rpc")?.inputSchema },
      { label: "MCP call action", schema: mcp.actions?.find((action) => action.id === "call-plastic-rpc")?.inputSchema }
    ];
    const mismatchedSchemas = schemas
      .filter((item) => stableJson(item.schema) !== stableJson(rpcCallInputSchema))
      .map((item) => item.label);
    assert(
      mismatchedSchemas.length === 0,
      `${source} agent transport schemas must match rpc/call input schema: ${mismatchedSchemas.join(", ")}`
    );
  }
};

const assertCanonicalTransports = ({ assert, items, source }) => {
  if (canonicalAgentTransports === null) {
    canonicalAgentTransports = stableJson(items);
    canonicalAgentTransportSource = source;
  } else {
    assert(
      stableJson(items) === canonicalAgentTransports,
      `${source} agent transports diverged from ${canonicalAgentTransportSource}`
    );
  }
};

export const assertAgentTransports = ({ assert, assertArray, transports, rpcUrl, source, methods }) => {
  const items = assertArray(transports, `${source} agentTransports is not an array`);
  const methodItems = Array.isArray(methods) ? methods : [];
  const methodsById = Object.fromEntries(methodItems.map((method) => [method.id, method]));
  const methodIds = new Set(methodItems.map((method) => method.id));
  const http = items.find((transport) => transport.id === "http-rpc");
  const mcp = items.find((transport) => transport.id === "mcp-stdio");
  assert(items.length === 2, `${source} agentTransports must expose exactly HTTP RPC and MCP stdio`);
  assertHttpTransport({ assert, http, rpcUrl, source });
  assertMcpTransport({ assert, mcp, rpcUrl, source });
  assertDelegatedActions({ assert, items, methodsById, methodIds, source });
  assertTransportSchemas({ assert, http, mcp, rpcCallInputSchema: methodsById["rpc/call"]?.inputSchema, source });
  assertCanonicalTransports({ assert, items, source });
  return { count: items.length };
};
