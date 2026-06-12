import { assertControlPlaneEndpointUrls } from "./plastic-contract-control-plane.mjs";
import { assertAgentTransports } from "./plastic-contract-agent-transports.mjs";

export const assertAgentWorkbenchPacket = ({ assert, assertArray, workbench, mode }) => {
  assert(workbench?.app?.mode === mode, "workbench app mode does not match state");
  assert(workbench.app.hostBase?.id === "runtime-host-base" && workbench.app.hostBase?.version === 1, "workbench shared host base marker mismatch");
  assert(workbench.control?.methodCount >= 1, "workbench method count missing");
  assert(workbench.control.capabilities?.count >= 1, "workbench capabilities count missing");
  assertArray(workbench.control.capabilities.items, "workbench capabilities items missing");
  assert(workbench.control.modules?.count >= 1, "workbench runtime module count missing");
  assertArray(workbench.control.modules.items, "workbench runtime modules items missing");
  assert(workbench.control.auditStatus?.verdict, "workbench missing compact audit status");
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

export const assertAgentOrientationPacket = ({ assert, assertArray, orientation }) => {
  assert(orientation?.agent?.id, "agent/orient missing agent id");
  assert(orientation.embodiment?.projectDir, "agent/orient missing projectDir");
  assert(orientation.capabilities?.hostBase?.id === "runtime-host-base" && orientation.capabilities.hostBase?.version === 1, "agent/orient shared host base marker mismatch");
  assert(orientation.capabilities.host?.count >= 1, "agent/orient missing host capability count");
  assertArray(orientation.capabilities.host.items, "agent/orient host capabilities missing");
  assertArray(orientation.capabilities?.recommendedActions, "agent/orient missing recommendedActions");
  assert(orientation.capabilities.modules?.count >= 1, "agent/orient missing runtime module count");
  assertArray(orientation.capabilities.modules.items, "agent/orient runtime modules missing");
  assert(orientation.capabilities.auditStatus?.verdict, "agent/orient missing compact audit status");
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
    modules: orientation.capabilities.modules.count,
    controlPlane: orientation.capabilities.controlPlane.runtime.transport,
    agentTransports: orientation.capabilities.agentTransports.length,
    visibleRefs: orientation.visibleContext?.visibleRefs?.length ?? 0,
    recommendedActions: orientation.capabilities.recommendedActions.length
  };
};
