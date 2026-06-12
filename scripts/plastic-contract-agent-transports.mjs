export const assertAgentTransports = ({ assert, assertArray, transports, rpcUrl, source }) => {
  const items = assertArray(transports, `${source} agentTransports is not an array`);
  const selfTestUrl = rpcUrl.replace(/\/rpc$/, "/self-test");
  const http = items.find((transport) => transport.id === "http-rpc");
  const mcp = items.find((transport) => transport.id === "mcp-stdio");
  assert(http?.status === "available", `${source} missing available HTTP RPC transport`);
  assert(http.methodRegistry === "shared", `${source} HTTP transport must use shared registry`);
  assert(http.rpcUrl === rpcUrl, `${source} HTTP transport URL mismatch`);
  assert(http.links?.some((link) => link.rel === "methods" && link.method === "http/get"), `${source} HTTP transport missing methods link`);
  assert(http.links?.some((link) => link.rel === "self-test" && link.method === "http/get" && link.href === selfTestUrl), `${source} HTTP transport missing self-test link`);
  assert(http.actions?.some((action) => action.id === "call-plastic-rpc" && action.method === "http/post" && action.href === rpcUrl), `${source} HTTP transport missing call action`);
  assert(mcp?.status === "available", `${source} missing available MCP stdio transport`);
  assert(mcp.methodRegistry === "shared", `${source} MCP transport must use shared registry`);
  assert(mcp.command === "node" && mcp.args?.includes("scripts/plastic-mcp-server.mjs"), `${source} MCP command mismatch`);
  assert(mcp.env?.PLASTIC_RPC_URL === rpcUrl, `${source} MCP RPC URL mismatch`);
  assert(mcp.tools?.some((tool) => tool.name === "plastic_rpc" && tool.methodRegistry === "shared"), `${source} MCP transport missing plastic_rpc tool metadata`);
  assert(mcp.actions?.some((action) => action.id === "call-plastic-rpc" && action.tool === "plastic_rpc" && action.arguments?.method === "agent/orient"), `${source} MCP transport missing plastic_rpc call action`);
  return { count: items.length };
};
