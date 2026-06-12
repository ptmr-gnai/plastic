import { assert, rpc, rpcUrl } from "./plastic-contract-helpers.mjs";
import { createPlasticMcpClient } from "./plastic-mcp-client.mjs";

const actorId = `contract.mcp.${Date.now()}`;

const callPlasticRpcTool = (mcp, { id, method, input }) =>
  mcp.callTool({
    id,
    arguments: { method, input }
  });

const assertMcpToolMetadata = async (mcp) => {
  const listedTools = await mcp.listTools();
  const plasticTool = listedTools.find((candidate) => candidate.name === "plastic_rpc");
  assert(plasticTool, "MCP tools/list missing plastic_rpc");
  assert(plasticTool.description?.includes("agent/orient"), "MCP plastic_rpc description must teach agent/orient");
  assert(plasticTool.description?.includes("runtime/auditStatus"), "MCP plastic_rpc description must teach runtime/auditStatus");
  assert(plasticTool.description?.includes("runtime/auditActionPlan"), "MCP plastic_rpc description must teach runtime/auditActionPlan");
};

const initializeMcp = async (mcp) => {
  const initialized = await mcp.initialize();
  assert(initialized.result?.serverInfo?.name === "plastic", "MCP initialize returned wrong server");
};

const run = async () => {
  const mcp = createPlasticMcpClient({
    env: {
      PLASTIC_RPC_URL: rpcUrl,
      PLASTIC_MCP_ACTOR_ID: actorId
    }
  });

  try {
    await initializeMcp(mcp);
    await assertMcpToolMetadata(mcp);

    const payload = await callPlasticRpcTool(mcp, {
      id: 3,
      method: "runtime/auditStatus",
      input: {}
    });
    assert(payload.ok === true, "MCP Plastic RPC call failed");
    assert(payload.methodEffects?.reversibility?.reversible === true, "MCP result missing delegated read-only reversibility");
    assert(Array.isArray(payload.methodEffects?.effects?.durableEvents), "MCP result missing delegated effects");
    const actionId = payload.value?.verdict?.actions?.[0]?.id;
    assert(typeof actionId === "string", "MCP auditStatus result missing current action id");

    const planPayload = await callPlasticRpcTool(mcp, {
      id: 4,
      method: "runtime/auditActionPlan",
      input: { id: actionId }
    });
    assert(planPayload.ok === true, "MCP auditActionPlan call failed");
    assert(planPayload.value?.id === actionId, "MCP auditActionPlan id mismatch");
    assert(planPayload.value?.invocation?.method === "runtime/runAuditAction", "MCP auditActionPlan invocation mismatch");
    assert(planPayload.value?.audit?.metadata?.schemaVersion === payload.value?.summary?.schemaVersion, "MCP auditActionPlan metadata schema mismatch");
    assert(planPayload.value?.audit?.metadata?.generatedAt === payload.value?.summary?.generatedAt, "MCP auditActionPlan metadata timestamp mismatch");
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
    mcp.close();
  }
};

await run();
