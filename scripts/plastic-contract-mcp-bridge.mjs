import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { assert, rpc, rpcUrl } from "./plastic-contract-helpers.mjs";

const actorId = `contract.mcp.${Date.now()}`;

const parseJsonLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

const waitForResponse = async (responses, id, stderr) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = responses.find((candidate) => candidate.id === id);
    if (response) {
      return response;
    }
    await delay(250);
  }
  throw new Error(`MCP response ${id} was not returned. stderr: ${stderr() || "<empty>"}`);
};

const callMcpTool = async ({ mcp, responses, stderr, id, method, input }) => {
  mcp.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "plastic_rpc",
      arguments: { method, input }
    }
  }) + "\n");
  const response = await waitForResponse(responses, id, stderr);
  assert(response.result?.content?.[0]?.type === "text", "MCP tool response missing text content");
  return JSON.parse(response.result.content[0].text);
};

const run = async () => {
  const mcp = spawn("node", ["scripts/plastic-mcp-server.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PLASTIC_RPC_URL: rpcUrl,
      PLASTIC_MCP_ACTOR_ID: actorId
    }
  });
  const responses = [];
  let stderrText = "";
  mcp.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
      const parsed = parseJsonLine(line);
      if (parsed) {
        responses.push(parsed);
      }
    }
  });
  mcp.stderr.on("data", (chunk) => {
    stderrText += chunk.toString();
  });

  try {
    mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    const initialized = await waitForResponse(responses, 1, () => stderrText);
    assert(initialized.result?.serverInfo?.name === "plastic", "MCP initialize returned wrong server");

    const payload = await callMcpTool({
      mcp,
      responses,
      stderr: () => stderrText,
      id: 2,
      method: "runtime/auditStatus",
      input: {}
    });
    assert(payload.ok === true, "MCP Plastic RPC call failed");
    assert(payload.methodEffects?.reversibility?.reversible === true, "MCP result missing delegated read-only reversibility");
    assert(Array.isArray(payload.methodEffects?.effects?.durableEvents), "MCP result missing delegated effects");
    const actionId = payload.value?.verdict?.actions?.[0]?.id;
    assert(typeof actionId === "string", "MCP auditStatus result missing current action id");

    const planPayload = await callMcpTool({
      mcp,
      responses,
      stderr: () => stderrText,
      id: 3,
      method: "runtime/auditActionPlan",
      input: { id: actionId }
    });
    assert(planPayload.ok === true, "MCP auditActionPlan call failed");
    assert(planPayload.value?.id === actionId, "MCP auditActionPlan id mismatch");
    assert(planPayload.value?.invocation?.method === "runtime/runAuditAction", "MCP auditActionPlan invocation mismatch");
    assert(planPayload.methodEffects?.reversibility?.reversible === true, "MCP auditActionPlan missing read-only reversibility");
    assert(planPayload.methodEffects?.effects?.durableEvents?.length === 0, "MCP auditActionPlan should not append durable events");

    const events = await rpc("events/list", {
      types: ["bridge.plastic_rpc.requested", "bridge.plastic_rpc.completed"],
      scope: { agentId: actorId },
      limit: 10
    });
    assert(Array.isArray(events), "events/list did not return events");
    assert(events.some((event) => event.type === "bridge.plastic_rpc.requested" && event.payload?.methodEffects), "MCP requested event missing method effects");
    assert(events.some((event) => event.type === "bridge.plastic_rpc.completed" && event.payload?.methodEffects), "MCP completed event missing method effects");

    console.log(JSON.stringify({
      ok: true,
      rpcUrl,
      actorId,
      methods: ["runtime/auditStatus", "runtime/auditActionPlan"],
      plannedAction: planPayload.value.id,
      reversible: payload.methodEffects.reversibility.reversible,
      durableEvents: payload.methodEffects.effects.durableEvents,
      bridgeEvents: events.filter((event) => event.type?.startsWith("bridge.plastic_rpc.")).length
    }, null, 2));
  } finally {
    mcp.kill("SIGTERM");
  }
};

await run();
