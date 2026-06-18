import { assert, rpc, rpcUrl } from "./plastic-contract-helpers.mjs";
import { createPlasticMcpClient } from "./plastic-mcp-client.mjs";
import { stableJson } from "./plastic-stable-json.mjs";

const actorId = `contract.mcp.${Date.now()}`;

const callPlasticRpcTool = (mcp, { id, method, input }) =>
  mcp.callTool({
    id,
    arguments: { method, input }
  });

const assertMcpToolMetadata = async (mcp) => {
  const listedTools = await mcp.listTools();
  const plasticTool = listedTools.find((candidate) => candidate.name === "plastic_rpc");
  const rpcCall = await rpc("methods/describe", { id: "rpc/call" });
  assert(plasticTool, "MCP tools/list missing plastic_rpc");
  assert(plasticTool.description?.includes("agent/orient"), "MCP plastic_rpc description must teach agent/orient");
  assert(plasticTool.description?.includes("runtime/auditStatus"), "MCP plastic_rpc description must teach runtime/auditStatus");
  assert(plasticTool.description?.includes("runtime/auditActionPlan"), "MCP plastic_rpc description must teach runtime/auditActionPlan");
  assert(stableJson(plasticTool.inputSchema) === stableJson(rpcCall.inputSchema), "MCP plastic_rpc input schema must match rpc/call");
};

const initializeMcp = async (mcp) => {
  const initialized = await mcp.initialize();
  assert(initialized.result?.serverInfo?.name === "plastic", "MCP initialize returned wrong server");
};

const assertDelegatedMethodEffects = async ({ method, payload }) => {
  const description = await rpc("methods/describe", { id: method });
  const effects = payload.methodEffects;
  assert(effects?.id === description.id, `${method} MCP methodEffects id mismatch`);
  assert(effects.title === description.title, `${method} MCP methodEffects title mismatch`);
  assert(stableJson(effects.owner) === stableJson(description.owner), `${method} MCP methodEffects owner mismatch`);
  assert(stableJson(effects.inputSchema) === stableJson(description.inputSchema), `${method} MCP methodEffects inputSchema mismatch`);
  assert(stableJson(effects.outputSchema) === stableJson(description.outputSchema), `${method} MCP methodEffects outputSchema mismatch`);
  assert(stableJson(effects.effects) === stableJson(description.effects), `${method} MCP methodEffects effects mismatch`);
  assert(stableJson(effects.reversibility) === stableJson(description.reversibility), `${method} MCP methodEffects reversibility mismatch`);
};

const assertBridgeEventEffects = ({ events, method, input, payload }) => {
  const requested = events.find((event) => event.payload?.method === method && event.type === "bridge.plastic_rpc.requested");
  const completed = events.find((event) => event.payload?.method === method && event.type === "bridge.plastic_rpc.completed" && event.payload?.ok === true);
  assert(requested && completed, `${method} MCP bridge events missing request/completion pair`);
  assert(stableJson(requested.payload?.input) === stableJson(input), `${method} MCP bridge requested input mismatch`);
  assert(stableJson(requested.payload?.methodEffects) === stableJson(payload.methodEffects), `${method} MCP bridge requested methodEffects mismatch`);
  assert(stableJson(completed.payload?.methodEffects) === stableJson(payload.methodEffects), `${method} MCP bridge completed methodEffects mismatch`);
  assert(stableJson(completed.payload?.value) === stableJson(payload.value), `${method} MCP bridge completed value mismatch`);
};

const assertMcpErrorPaths = async (mcp) => {
  const missingMethod = await callPlasticRpcTool(mcp, { id: 5, method: "", input: {} });
  assert(missingMethod.ok === false, "MCP missing method did not return ok:false");
  assert(missingMethod.error?.includes("requires method"), "MCP missing method error mismatch");

  const missingRpcMethod = `contract/missing-${actorId}`;
  const missingRpc = await callPlasticRpcTool(mcp, { id: 6, method: missingRpcMethod, input: {} });
  assert(missingRpc.ok === false, "MCP unknown delegated method did not return ok:false");
  assert(missingRpc.error?.includes("not found"), "MCP unknown delegated method error mismatch");
  assert(missingRpc.methodEffects?.error?.includes("not found"), "MCP unknown delegated method missing methodEffects error");
  const events = await rpc("events/list", {
    types: ["bridge.plastic_rpc.requested", "bridge.plastic_rpc.completed"],
    scope: { agentId: actorId },
    limit: 20
  });
  assert(Array.isArray(events), "MCP error events/list did not return events");
  assert(!events.some((event) => event.payload?.method === ""), "MCP missing method should not append bridge events");
  const requested = events.find((event) => event.type === "bridge.plastic_rpc.requested" && event.payload?.method === missingRpcMethod);
  const completed = events.find((event) => event.type === "bridge.plastic_rpc.completed" && event.payload?.method === missingRpcMethod && event.payload?.ok === false);
  assert(requested, "MCP unknown delegated method missing requested event");
  assert(completed, "MCP unknown delegated method missing failed completion event");
  assert(stableJson(requested.payload?.methodEffects) === stableJson(missingRpc.methodEffects), "MCP failed requested event methodEffects mismatch");
  assert(stableJson(completed.payload?.methodEffects) === stableJson(missingRpc.methodEffects), "MCP failed completion event methodEffects mismatch");
  assert(completed.payload?.error === missingRpc.error, "MCP failed completion event error mismatch");
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
    await assertDelegatedMethodEffects({ method: "runtime/auditStatus", payload });
    assert(payload.methodEffects?.reversibility?.reversible === true, "MCP result missing delegated read-only reversibility");
    assert(Array.isArray(payload.methodEffects?.effects?.durableEvents), "MCP result missing delegated effects");
    const actionId = payload.value?.verdict?.actions?.[0]?.id;
    const planPayload = typeof actionId === "string"
      ? await callPlasticRpcTool(mcp, {
        id: 4,
        method: "runtime/auditActionPlan",
        input: { id: actionId }
      })
      : null;
    if (planPayload === null) {
      assert(payload.value?.verdict?.status === "running", "MCP auditStatus may only omit current action while running");
    } else {
      assert(planPayload.ok === true, "MCP auditActionPlan call failed");
      await assertDelegatedMethodEffects({ method: "runtime/auditActionPlan", payload: planPayload });
      assert(planPayload.value?.id === actionId, "MCP auditActionPlan id mismatch");
      assert(planPayload.value?.invocation?.method === "runtime/runAuditAction", "MCP auditActionPlan invocation mismatch");
      assert(planPayload.value?.audit?.metadata?.schemaVersion === payload.value?.summary?.schemaVersion, "MCP auditActionPlan metadata schema mismatch");
      assert(planPayload.value?.audit?.metadata?.generatedAt === payload.value?.summary?.generatedAt, "MCP auditActionPlan metadata timestamp mismatch");
      assert(planPayload.methodEffects?.reversibility?.reversible === true, "MCP auditActionPlan missing read-only reversibility");
      assert(planPayload.methodEffects?.effects?.durableEvents?.length === 0, "MCP auditActionPlan should not append durable events");
    }

    const events = await rpc("events/list", {
      types: ["bridge.plastic_rpc.requested", "bridge.plastic_rpc.completed"],
      scope: { agentId: actorId },
      limit: 10
    });
    assert(Array.isArray(events), "events/list did not return events");
    assert(events.some((event) => event.type === "bridge.plastic_rpc.requested" && event.payload?.methodEffects), "MCP requested event missing method effects");
    assert(events.some((event) => event.type === "bridge.plastic_rpc.completed" && event.payload?.methodEffects), "MCP completed event missing method effects");
    assertBridgeEventEffects({ events, method: "runtime/auditStatus", input: {}, payload });
    if (planPayload !== null) {
      assertBridgeEventEffects({ events, method: "runtime/auditActionPlan", input: { id: actionId }, payload: planPayload });
    }
    await assertMcpErrorPaths(mcp);

    console.log(JSON.stringify({
      ok: true,
      rpcUrl,
      actorId,
      methods: planPayload === null ? ["runtime/auditStatus"] : ["runtime/auditStatus", "runtime/auditActionPlan"],
      plannedAction: planPayload?.value?.id ?? null,
      reversible: payload.methodEffects.reversibility.reversible,
      durableEvents: payload.methodEffects.effects.durableEvents,
      bridgeEvents: events.filter((event) => event.type?.startsWith("bridge.plastic_rpc.")).length
    }, null, 2));
  } finally {
    mcp.close();
  }
};

await run();
