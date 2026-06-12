import { assertControlPlaneEndpointUrls } from "./plastic-contract-control-plane.mjs";
import { assertAgentTransports } from "./plastic-contract-agent-transports.mjs";

export const assertAgentWorkbenchPacket = ({ assert, assertArray, workbench, mode, methodCount, capabilityCount, moduleIds }) => {
  assert(workbench?.app?.mode === mode, "workbench app mode does not match state");
  assert(workbench.app.hostBase?.id === "runtime-host-base" && workbench.app.hostBase?.version === 1, "workbench shared host base marker mismatch");
  assert(workbench.control?.methodCount >= 1, "workbench method count missing");
  assert(workbench.control.methodCount === methodCount, "workbench method count does not match plastic/methods");
  assert(workbench.control.capabilities?.count >= 1, "workbench capabilities count missing");
  assert(workbench.control.capabilities.count === capabilityCount, "workbench capability count does not match runtime/capabilities");
  assertArray(workbench.control.capabilities.items, "workbench capabilities items missing");
  assert(workbench.control.modules?.count >= 1, "workbench runtime module count missing");
  assert(workbench.control.modules.count === moduleIds.length, "workbench module count does not match runtime/modules");
  assertArray(workbench.control.modules.items, "workbench runtime modules items missing");
  assertSameModuleIds({ assert, actual: workbench.control.modules.items, expected: moduleIds, source: "workbench" });
  assert(workbench.control.auditStatus?.verdict, "workbench missing compact audit status");
  assert(typeof workbench.control.auditStatus.failureSummary?.count === "number", "workbench audit status missing failure summary");
  assert(Array.isArray(workbench.control.auditStatus.failureSummary.ids), "workbench audit status missing failure ids");
  assertArray(workbench.control.auditStatus.actionIds, "workbench audit status action ids missing");
  assertArray(workbench.control.auditStatus.recentActions, "workbench audit status recent actions missing");
  assert(workbench.control.controlPlane?.runtime?.transport === "http", "workbench missing runtime control plane");
  assert(workbench.control.controlPlane.runtime.rpcPath === "/rpc", "workbench runtime control plane rpcPath mismatch");
  assert(workbench.control.controlPlane.runtime.statePath === "/state", "workbench runtime control plane statePath mismatch");
  assert(workbench.control.controlPlane.runtime.methodsPath === "/methods", "workbench runtime control plane methodsPath mismatch");
  assert(workbench.control.controlPlane?.build?.transport === "http", "workbench missing build control plane");
  assert(workbench.control.controlPlane.build.rpcPath === "/rpc", "workbench build control plane rpcPath mismatch");
  assert(workbench.control.controlPlane.build.statePath === "/state", "workbench build control plane statePath mismatch");
  assert(workbench.control.controlPlane.build.methodsPath === "/methods", "workbench build control plane methodsPath mismatch");
  assert(workbench.control.controlPlane.build.eventStreamPath === "/events/stream", "workbench build control plane eventStreamPath mismatch");
  assertControlPlaneEndpointUrls({ assert, controlPlane: workbench.control.controlPlane, source: "workbench" });
  assertAgentTransports({ assert, assertArray, transports: workbench.control.agentTransports, rpcUrl: workbench.control.controlPlane.runtime.rpcUrl, source: "workbench" });
  assertArray(workbench.control.recommendedActions, "workbench recommendedActions is not an array");
  assert(workbench.control.recommendedActions.some((action) => action.method === "runtime/modules"), "workbench missing runtime/modules recommended action");
  assert(workbench.control.recommendedActions.some((action) => action.method === "runtime/host"), "workbench missing runtime/host recommended action");
  assert(workbench.control.recommendedActions.some((action) => action.method === "runtime/auditStatus"), "workbench missing runtime/auditStatus recommended action");
  assert(workbench.control.recommendedActions.some((action) => action.method === "runtime/auditActionPlan"), "workbench missing runtime/auditActionPlan recommended action");
  assert(workbench.control.recommendedActions.some((action) => action.method === "runtime/runAuditAction"), "workbench missing runtime/runAuditAction recommended action");
  assert(workbench.control.recommendedActions.some((action) => action.method === "events/list" && action.input?.types?.includes("runtime.started")), "workbench missing control plane recommended action");
  assert(workbench.control.recommendedActions.some((action) => action.id === "read-timeline" && action.method === "events/timeline"), "workbench read-timeline action must use shared events/timeline");
  assert(workbench.observability?.timeline, "workbench timeline missing");
  assert(workbench.workspace?.git, "workbench git status missing");
  return {
    mode: workbench.app.mode,
    methods: workbench.control.methodCount,
    capabilities: workbench.control.capabilities.count,
    modules: workbench.control.modules.count,
    controlPlane: workbench.control.controlPlane.runtime.transport,
    agentTransports: workbench.control.agentTransports.length,
    actions: workbench.control.recommendedActions.length,
    visibleRefs: workbench.observability.visibleRefs?.length ?? 0
  };
};

export const assertAgentOrientationPacket = ({ assert, assertArray, orientation, methodCount, capabilityCount, moduleIds }) => {
  assert(orientation?.agent?.id, "agent/orient missing agent id");
  assert(orientation.embodiment?.projectDir, "agent/orient missing projectDir");
  assert(orientation.capabilities?.hostBase?.id === "runtime-host-base" && orientation.capabilities.hostBase?.version === 1, "agent/orient shared host base marker mismatch");
  assert(orientation.capabilities.host?.count >= 1, "agent/orient missing host capability count");
  assert(orientation.capabilities.host.count === capabilityCount, "agent/orient capability count does not match runtime/capabilities");
  assertArray(orientation.capabilities.host.items, "agent/orient host capabilities missing");
  assertArray(orientation.capabilities?.recommendedActions, "agent/orient missing recommendedActions");
  assert(orientation.capabilities.modules?.count >= 1, "agent/orient missing runtime module count");
  assert(orientation.capabilities.modules.count === moduleIds.length, "agent/orient module count does not match runtime/modules");
  assertArray(orientation.capabilities.modules.items, "agent/orient runtime modules missing");
  assertSameModuleIds({ assert, actual: orientation.capabilities.modules.items, expected: moduleIds, source: "agent/orient" });
  assert(orientation.capabilities.methodCount === methodCount, "agent/orient method count does not match plastic/methods");
  assertArray(orientation.capabilities.methods, "agent/orient recommended methods missing");
  assert(
    orientation.capabilities.methods.every((method) => typeof method.id === "string" && typeof method.title === "string"),
    "agent/orient recommended methods have invalid shape"
  );
  assert(orientation.capabilities.auditStatus?.verdict, "agent/orient missing compact audit status");
  assert(typeof orientation.capabilities.auditStatus.failureSummary?.count === "number", "agent/orient audit status missing failure summary");
  assert(Array.isArray(orientation.capabilities.auditStatus.failureSummary.ids), "agent/orient audit status missing failure ids");
  assertArray(orientation.capabilities.auditStatus.actionIds, "agent/orient audit status action ids missing");
  assertArray(orientation.capabilities.auditStatus.recentActions, "agent/orient audit status recent actions missing");
  assert(orientation.capabilities.controlPlane?.runtime?.transport === "http", "agent/orient missing runtime control plane");
  assert(orientation.capabilities.controlPlane.runtime.rpcPath === "/rpc", "agent/orient runtime control plane rpcPath mismatch");
  assert(orientation.capabilities.controlPlane.runtime.statePath === "/state", "agent/orient runtime control plane statePath mismatch");
  assert(orientation.capabilities.controlPlane.runtime.methodsPath === "/methods", "agent/orient runtime control plane methodsPath mismatch");
  assert(orientation.capabilities.controlPlane?.build?.transport === "http", "agent/orient missing build control plane");
  assert(orientation.capabilities.controlPlane.build.rpcPath === "/rpc", "agent/orient build control plane rpcPath mismatch");
  assert(orientation.capabilities.controlPlane.build.statePath === "/state", "agent/orient build control plane statePath mismatch");
  assert(orientation.capabilities.controlPlane.build.methodsPath === "/methods", "agent/orient build control plane methodsPath mismatch");
  assert(orientation.capabilities.controlPlane.build.eventStreamPath === "/events/stream", "agent/orient build control plane eventStreamPath mismatch");
  assertControlPlaneEndpointUrls({ assert, controlPlane: orientation.capabilities.controlPlane, source: "agent/orient" });
  assertAgentTransports({ assert, assertArray, transports: orientation.capabilities.agentTransports, rpcUrl: orientation.capabilities.controlPlane.runtime.rpcUrl, source: "agent/orient" });
  assert(orientation.capabilities.links?.some((link) => link.method === "runtime/modules"), "agent/orient missing runtime/modules link");
  assert(
    orientation.capabilities.links?.some((link) => link.method === "runtime/host")
      && orientation.capabilities.recommendedActions?.some((action) => action.method === "runtime/host"),
    "agent/orient missing runtime/host affordance"
  );
  assert(
    orientation.capabilities.links?.some((link) => link.method === "runtime/auditStatus")
      && orientation.capabilities.recommendedActions?.some((action) => action.method === "runtime/auditStatus"),
    "agent/orient missing runtime/auditStatus affordance"
  );
  assert(
    orientation.capabilities.links?.some((link) => link.method === "runtime/runAuditAction")
      && orientation.capabilities.recommendedActions?.some((action) => action.method === "runtime/runAuditAction"),
    "agent/orient missing runtime/runAuditAction affordance"
  );
  assert(
    orientation.capabilities.links?.some((link) => link.method === "runtime/auditActionPlan")
      && orientation.capabilities.recommendedActions?.some((action) => action.method === "runtime/auditActionPlan"),
    "agent/orient missing runtime/auditActionPlan affordance"
  );
  assert(orientation.capabilities.links?.some((link) => link.rel === "control-plane" && link.method === "events/list"), "agent/orient missing control plane link");
  assert(orientation.memory?.eventCount >= 1, "agent/orient missing event memory");
  return {
    agentId: orientation.agent.id,
    panelId: orientation.embodiment.panelId,
    capabilities: orientation.capabilities.host.count,
    methods: orientation.capabilities.methodCount,
    modules: orientation.capabilities.modules.count,
    controlPlane: orientation.capabilities.controlPlane.runtime.transport,
    agentTransports: orientation.capabilities.agentTransports.length,
    visibleRefs: orientation.visibleContext?.visibleRefs?.length ?? 0,
    recommendedActions: orientation.capabilities.recommendedActions.length
  };
};

const assertSameModuleIds = ({ assert, actual, expected, source }) => {
  const actualIds = actual.map((module) => module.id).sort();
  const expectedIds = [...expected].sort();
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `${source} module ids do not match runtime/modules`);
};
