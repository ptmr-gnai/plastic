import { join } from "node:path";

type CodexMcpConfigInput = {
  workspaceDir: string;
  runtimeRpcUrl: string;
  request: (method: string, params?: unknown) => Promise<unknown>;
  appendCodexEvent: (type: string, payload: unknown) => Promise<unknown>;
};

export const createCodexMcpConfig = (input: CodexMcpConfigInput) => {
  let configured = false;
  let lastError: string | null = null;
  const serverPath = join(input.workspaceDir, "scripts", "plastic-mcp-server.mjs");

  const state = () => ({
    configured,
    lastError,
    serverPath
  });

  const configure = async () => {
    const value = {
      command: "node",
      args: [serverPath],
      env: {
        PLASTIC_RPC_URL: input.runtimeRpcUrl,
        PLASTIC_MCP_ACTOR_ID: "plastic.mcp"
      },
      default_tools_enabled: true
    };

    try {
      const writeResult = await input.request("config/value/write", {
        keyPath: "mcp_servers.plastic",
        value,
        mergeStrategy: "upsert"
      });
      const reloadResult = await input.request("config/mcpServer/reload");
      configured = true;
      lastError = null;
      await input.appendCodexEvent("bridge.plastic_mcp.configured", {
        server: "plastic",
        tool: "plastic_rpc",
        path: serverPath,
        runtimeRpcUrl: input.runtimeRpcUrl,
        writeResult,
        reloadResult
      });
      return { configured: true, value, writeResult, reloadResult };
    } catch (error) {
      configured = false;
      lastError = error instanceof Error ? error.message : String(error);
      await input.appendCodexEvent("bridge.plastic_mcp.configure_failed", {
        server: "plastic",
        tool: "plastic_rpc",
        path: serverPath,
        runtimeRpcUrl: input.runtimeRpcUrl,
        error: lastError
      });
      throw error;
    }
  };

  return {
    configure,
    state
  };
};
