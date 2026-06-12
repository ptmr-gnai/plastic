import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const defaultTimeoutMs = 10_000;
const workspaceCwd = new URL("..", import.meta.url).pathname;

const parseJsonLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

export const createPlasticMcpClient = ({ command = "node", args = ["scripts/plastic-mcp-server.mjs"], env = {}, timeoutMs = defaultTimeoutMs } = {}) => {
  const child = spawn(command, args, {
    cwd: workspaceCwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env }
  });
  const responses = [];
  let stderrText = "";
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      const parsed = parseJsonLine(line);
      if (parsed) {
        responses.push(parsed);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrText += chunk.toString();
  });

  const waitForResponse = async (id) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const response = responses.find((candidate) => candidate.id === id);
      if (response) {
        return response;
      }
      await delay(100);
    }
    throw new Error(`MCP response ${id} was not returned. stderr: ${stderrText.trim() || "<empty>"}`);
  };

  const send = async ({ id, method, params = {} }) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const response = await waitForResponse(id);
    if (response.error) {
      throw new Error(`MCP ${method} failed: ${response.error.message ?? JSON.stringify(response.error)}`);
    }
    return response;
  };

  return {
    child,
    stderr: () => stderrText,
    initialize: () => send({ id: 1, method: "initialize" }),
    listTools: async ({ id = 2 } = {}) => {
      const response = await send({ id, method: "tools/list" });
      return response.result?.tools ?? [];
    },
    callTool: async ({ id, name = "plastic_rpc", arguments: toolArguments }) => {
      const response = await send({
        id,
        method: "tools/call",
        params: { name, arguments: toolArguments }
      });
      const content = response.result?.content?.[0];
      if (content?.type !== "text") {
        throw new Error(`MCP tool ${name} response missing text content`);
      }
      return JSON.parse(content.text);
    },
    close: () => {
      child.kill("SIGTERM");
    }
  };
};
