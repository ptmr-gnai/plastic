export const assertAgentTransports = ({ assert, assertArray, transports, rpcUrl, source }) => {
  const items = assertArray(transports, `${source} agentTransports is not an array`);
  const http = items.find((transport) => transport.id === "http-rpc");
  const mcp = items.find((transport) => transport.id === "mcp-stdio");
  assert(http?.status === "available", `${source} missing available HTTP RPC transport`);
  assert(http.methodRegistry === "shared", `${source} HTTP transport must use shared registry`);
  assert(http.rpcUrl === rpcUrl, `${source} HTTP transport URL mismatch`);
  assert(mcp?.status === "available", `${source} missing available MCP stdio transport`);
  assert(mcp.methodRegistry === "shared", `${source} MCP transport must use shared registry`);
  assert(mcp.command === "node" && mcp.args?.includes("scripts/plastic-mcp-server.mjs"), `${source} MCP command mismatch`);
  assert(mcp.env?.PLASTIC_RPC_URL === rpcUrl, `${source} MCP RPC URL mismatch`);
  return { count: items.length };
};
