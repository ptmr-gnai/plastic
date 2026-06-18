import { assertControlPlaneEndpointUrls } from "./plastic-contract-control-plane.mjs";
import { assertAgentTransports } from "./plastic-contract-agent-transports.mjs";
import { assertActionInputLegibility, assertLinkInputLegibility } from "./plastic-contract-affordances.mjs";
import {
  hasActionAffordance,
  hasLinkAffordance,
  requiredOrientationActions,
  requiredOrientationLinks,
  requiredWorkbenchActions,
  requiredWorkbenchLinks
} from "./plastic-contract-agent-affordances.mjs";
import { stableJson } from "./plastic-stable-json.mjs";

export const assertAgentWorkbenchPacket = ({ assert, assertArray, workbench, mode, methodCount, capabilityCount, modules, methodIds, methods }) => {
  const moduleIds = modules.ids;
  assert(workbench?.app?.mode === mode, "workbench app mode does not match state");
  assert(workbench.app.hostBase?.id === "runtime-host-base" && workbench.app.hostBase?.version === 1, "workbench shared host base marker mismatch");
  assert(workbench.control?.methodCount >= 1, "workbench method count missing");
  assert(workbench.control.methodCount === methodCount, "workbench method count does not match plastic/methods");
  assert(workbench.control.capabilities?.count >= 1, "workbench capabilities count missing");
  assert(workbench.control.capabilities.count === capabilityCount, "workbench capability count does not match runtime/capabilities");
  assertArray(workbench.control.capabilities.items, "workbench capabilities items missing");
  assertCapabilityStatuses({
    assert,
    items: workbench.control.capabilities.items,
    statuses: workbench.control.capabilities.statuses,
    source: "workbench"
  });
  assert(workbench.control.modules?.count >= 1, "workbench runtime module count missing");
  assert(workbench.control.modules.count === moduleIds.length, "workbench module count does not match runtime/modules");
  assertArray(workbench.control.modules.items, "workbench runtime modules items missing");
  assertSameModuleIds({ assert, actual: workbench.control.modules.items, expected: moduleIds, source: "workbench" });
  assertSameModuleAvailability({ assert, actual: workbench.control.modules.items, expected: modules.items, source: "workbench" });
  assert(workbench.control.auditStatus?.verdict, "workbench missing compact audit status");
  assertAgentAuditMetadata({ assert, auditStatus: workbench.control.auditStatus, source: "workbench" });
  assert(typeof workbench.control.auditStatus.failureSummary?.count === "number", "workbench audit status missing failure summary");
  assert(Array.isArray(workbench.control.auditStatus.failureSummary.ids), "workbench audit status missing failure ids");
  assertArray(workbench.control.auditStatus.actionIds, "workbench audit status action ids missing");
  assertArray(workbench.control.auditStatus.recentActions, "workbench audit status recent actions missing");
  assertRecentAuditActionRows({ assert, recentActions: workbench.control.auditStatus.recentActions, source: "workbench" });
  assertRecentAuditActionMetadata({ assert, recentActions: workbench.control.auditStatus.recentActions, source: "workbench" });
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
  assertAgentTransports({ assert, assertArray, transports: workbench.control.agentTransports, rpcUrl: workbench.control.controlPlane.runtime.rpcUrl, source: "workbench", methods });
  assertArray(workbench.control.recommendedActions, "workbench recommendedActions is not an array");
  assertArray(workbench.control.links, "workbench control links missing");
  assertKnownMethodReferences({ assert, references: workbench.control.links, methodIds, source: "workbench links" });
  assertLinkInputLegibility({ assert, links: workbench.control.links, methods, source: "workbench links" });
  assertKnownMethodReferences({ assert, references: workbench.control.recommendedActions, methodIds, source: "workbench recommendedActions" });
  assertActionInputLegibility({ assert, actions: workbench.control.recommendedActions, methods, source: "workbench recommendedActions" });
  assertActionMetadata({ assert, actions: workbench.control.recommendedActions, source: "workbench recommendedActions" });
  for (const action of requiredWorkbenchActions) {
    assert(hasActionAffordance(workbench.control.recommendedActions, action), `workbench missing ${action.id} recommended action`);
  }
  for (const link of requiredWorkbenchLinks) {
    assert(hasLinkAffordance(workbench.control.links, link), `workbench missing ${link.rel} link`);
  }
  assertFocusedPanelActions({
    assert,
    actions: workbench.control.recommendedActions,
    panelId: workbench.focus?.panelId,
    source: "workbench"
  });
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

export const assertAgentWorkbenchMethodDescription = ({ assert, description }) => {
  assert(description.id === "agent/workbench", "described wrong workbench method");
  assert(description.outputSchema?.required?.includes("control"), "agent/workbench output schema must require control");
  const actions = description.outputSchema?.properties?.control?.properties?.recommendedActions;
  assert(actions?.items?.properties?.intent?.enum?.includes("execute"), "agent/workbench output schema must expose action intent");
  assert(actions?.items?.properties?.risk?.enum?.includes("medium"), "agent/workbench output schema must expose action risk");
  assert(description.outputSchema?.properties?.control?.properties?.auditStatus?.properties?.audit?.properties?.methodParity?.required?.includes("failureTotal"), "agent/workbench output schema must expose audit method parity total");
  assert(description.outputSchema?.properties?.control?.properties?.auditStatus?.properties?.audit?.properties?.methodParity?.required?.includes("reportPath"), "agent/workbench output schema must expose audit method parity report path");
  assert(description.outputSchema?.properties?.control?.properties?.auditStatus?.properties?.recentActions?.items?.properties?.auditMetadata?.anyOf?.some((candidate) => candidate.properties?.methodParity), "agent/workbench output schema must expose recent audit action method parity");
  assert(description.outputSchema?.properties?.control?.properties?.auditStatus?.properties?.recentActions?.items?.required?.includes("actionId"), "agent/workbench output schema must expose recent audit action rows");
  assert(description.outputSchema?.properties?.control?.properties?.controlPlane?.required?.includes("runtime"), "agent/workbench output schema must expose runtime control plane");
  assert(description.outputSchema?.properties?.control?.properties?.links?.items?.type === "object", "agent/workbench output schema must expose control links");
  assert(description.outputSchema?.properties?.control?.properties?.agentTransports?.items?.properties?.actions?.items?.properties?.inputSchema, "agent/workbench output schema must expose transport action inputSchema");
  return { id: description.id, required: description.outputSchema.required };
};

export const assertAgentOrientationPacket = ({ assert, assertArray, orientation, methodCount, capabilityCount, modules, methodIds, methods }) => {
  const moduleIds = modules.ids;
  assert(orientation?.agent?.id, "agent/orient missing agent id");
  assert(orientation.embodiment?.projectDir, "agent/orient missing projectDir");
  assert(orientation.capabilities?.hostBase?.id === "runtime-host-base" && orientation.capabilities.hostBase?.version === 1, "agent/orient shared host base marker mismatch");
  assert(orientation.capabilities.host?.count >= 1, "agent/orient missing host capability count");
  assert(orientation.capabilities.host.count === capabilityCount, "agent/orient capability count does not match runtime/capabilities");
  assertArray(orientation.capabilities.host.items, "agent/orient host capabilities missing");
  assertCapabilityStatuses({
    assert,
    items: orientation.capabilities.host.items,
    statuses: orientation.capabilities.host.statuses,
    source: "agent/orient"
  });
  assertArray(orientation.capabilities?.recommendedActions, "agent/orient missing recommendedActions");
  assertKnownMethodReferences({ assert, references: orientation.capabilities.recommendedActions, methodIds, source: "agent/orient recommendedActions" });
  assertActionInputLegibility({ assert, actions: orientation.capabilities.recommendedActions, methods, source: "agent/orient recommendedActions" });
  assertActionMetadata({ assert, actions: orientation.capabilities.recommendedActions, source: "agent/orient recommendedActions" });
  assert(orientation.capabilities.modules?.count >= 1, "agent/orient missing runtime module count");
  assert(orientation.capabilities.modules.count === moduleIds.length, "agent/orient module count does not match runtime/modules");
  assertArray(orientation.capabilities.modules.items, "agent/orient runtime modules missing");
  assertSameModuleIds({ assert, actual: orientation.capabilities.modules.items, expected: moduleIds, source: "agent/orient" });
  assertSameModuleAvailability({ assert, actual: orientation.capabilities.modules.items, expected: modules.items, source: "agent/orient" });
  assert(orientation.capabilities.methodCount === methodCount, "agent/orient method count does not match plastic/methods");
  assertArray(orientation.capabilities.methods, "agent/orient recommended methods missing");
  assert(
    orientation.capabilities.methods.every((method) => typeof method.id === "string" && typeof method.title === "string"),
    "agent/orient recommended methods have invalid shape"
  );
  assert(orientation.capabilities.auditStatus?.verdict, "agent/orient missing compact audit status");
  assertAgentAuditMetadata({ assert, auditStatus: orientation.capabilities.auditStatus, source: "agent/orient" });
  assert(typeof orientation.capabilities.auditStatus.failureSummary?.count === "number", "agent/orient audit status missing failure summary");
  assert(Array.isArray(orientation.capabilities.auditStatus.failureSummary.ids), "agent/orient audit status missing failure ids");
  assertArray(orientation.capabilities.auditStatus.actionIds, "agent/orient audit status action ids missing");
  assertArray(orientation.capabilities.auditStatus.recentActions, "agent/orient audit status recent actions missing");
  assertRecentAuditActionRows({ assert, recentActions: orientation.capabilities.auditStatus.recentActions, source: "agent/orient" });
  assertRecentAuditActionMetadata({ assert, recentActions: orientation.capabilities.auditStatus.recentActions, source: "agent/orient" });
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
  assertAgentTransports({ assert, assertArray, transports: orientation.capabilities.agentTransports, rpcUrl: orientation.capabilities.controlPlane.runtime.rpcUrl, source: "agent/orient", methods });
  for (const action of requiredOrientationActions) {
    assert(hasActionAffordance(orientation.capabilities.recommendedActions, action), `agent/orient missing ${action.id} action`);
  }
  assertFocusedPanelActions({
    assert,
    actions: orientation.capabilities.recommendedActions,
    panelId: orientation.embodiment?.panelId,
    source: "agent/orient"
  });
  for (const link of requiredOrientationLinks) {
    assert(hasLinkAffordance(orientation.capabilities.links, link), `agent/orient missing ${link.rel} link`);
  }
  assertKnownMethodReferences({ assert, references: orientation.capabilities.links ?? [], methodIds, source: "agent/orient links" });
  assertLinkInputLegibility({ assert, links: orientation.capabilities.links, methods, source: "agent/orient links" });
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

export const assertAgentOrientMethodDescription = ({ assert, description }) => {
  assert(description.id === "agent/orient", "described wrong orientation method");
  assert(description.outputSchema?.required?.includes("capabilities"), "agent/orient output schema must require capabilities");
  const actions = description.outputSchema?.properties?.capabilities?.properties?.recommendedActions;
  assert(actions?.items?.properties?.intent?.enum?.includes("inspect"), "agent/orient output schema must expose action intent");
  assert(actions?.items?.properties?.risk?.enum?.includes("medium"), "agent/orient output schema must expose action risk");
  assert(description.outputSchema?.properties?.capabilities?.properties?.auditStatus?.properties?.audit?.properties?.methodParity?.required?.includes("failureTotal"), "agent/orient output schema must expose audit method parity total");
  assert(description.outputSchema?.properties?.capabilities?.properties?.auditStatus?.properties?.audit?.properties?.methodParity?.required?.includes("reportPath"), "agent/orient output schema must expose audit method parity report path");
  assert(description.outputSchema?.properties?.capabilities?.properties?.auditStatus?.properties?.recentActions?.items?.required?.includes("actionId"), "agent/orient output schema must expose recent audit action rows");
  assert(description.outputSchema?.properties?.capabilities?.properties?.controlPlane?.required?.includes("build"), "agent/orient output schema must expose build control plane");
  assert(description.outputSchema?.properties?.capabilities?.properties?.agentTransports?.items?.properties?.actions?.items?.properties?.inputSchema, "agent/orient output schema must expose transport action inputSchema");
  return { id: description.id, required: description.outputSchema.required };
};

const assertCapabilityStatuses = ({ assert, items, statuses, source }) => {
  assert(statuses && typeof statuses === "object" && !Array.isArray(statuses), `${source} capability statuses missing`);
  const expected = Object.fromEntries(items.map((capability) => [capability.id, capability.status]));
  assert(stableJson(statuses) === stableJson(expected), `${source} capability statuses do not match capability items`);
};

const assertAgentAuditMetadata = ({ assert, auditStatus, source }) => {
  assert(auditStatus.audit?.schemaVersion === 1, `${source} audit status missing schema version`);
  assert(typeof auditStatus.audit.generatedAt === "string" && !Number.isNaN(Date.parse(auditStatus.audit.generatedAt)), `${source} audit status missing generated timestamp`);
  assert(typeof auditStatus.audit.inProgress === "boolean", `${source} audit status missing progress flag`);
  assert(typeof auditStatus.audit.checks === "number", `${source} audit status missing check count`);
  assert(typeof auditStatus.audit.expectedChecks === "number", `${source} audit status missing expected check count`);
  assert(Array.isArray(auditStatus.audit.expectedStepIds), `${source} audit status missing expected step ids`);
  assert(typeof auditStatus.audit.usable === "boolean", `${source} audit status missing usable flag`);
  assert(typeof auditStatus.audit.strictElectron === "string", `${source} audit status missing strict Electron status`);
  assert(typeof auditStatus.audit.unified === "string", `${source} audit status missing unified status`);
  assert(typeof auditStatus.audit.methodParity?.mode === "string", `${source} audit status missing method parity mode`);
  assert(auditStatus.audit.methodParity.reportPath === null || typeof auditStatus.audit.methodParity.reportPath === "string", `${source} audit status invalid method parity report path`);
  assert(auditStatus.audit.methodParity.failureTotal === null || typeof auditStatus.audit.methodParity.failureTotal === "number", `${source} audit status invalid method parity total`);
};

const assertRecentAuditActionMetadata = ({ assert, recentActions, source }) => {
  for (const action of recentActions) {
    if (action.auditMetadata === null) {
      continue;
    }
    assertCompactAuditMetadata({ assert, metadata: action.auditMetadata, source: `${source} recent audit action metadata` });
  }
};

const assertRecentAuditActionRows = ({ assert, recentActions, source }) => {
  const invalidRows = recentActions.filter((action) =>
    (action.actionId !== null && typeof action.actionId !== "string")
    || typeof action.ok !== "boolean"
    || (action.exitCode !== null && typeof action.exitCode !== "number")
    || !action.env
    || typeof action.env !== "object"
    || Array.isArray(action.env)
  );
  assert(invalidRows.length === 0, `${source} recent audit action rows have invalid shape`);
};

const assertCompactAuditMetadata = ({ assert, metadata, source }) => {
  assert(metadata?.schemaVersion === 1, `${source} must be schema-versioned`);
  assert(typeof metadata.generatedAt === "string" && !Number.isNaN(Date.parse(metadata.generatedAt)), `${source} missing generated timestamp`);
  assert(typeof metadata.inProgress === "boolean", `${source} missing progress flag`);
  assert(typeof metadata.checks === "number", `${source} missing check count`);
  assert(typeof metadata.expectedChecks === "number", `${source} missing expected check count`);
  assert(Array.isArray(metadata.expectedStepIds), `${source} missing expected step ids`);
  assert(typeof metadata.usable === "boolean", `${source} missing usable flag`);
  assert(typeof metadata.strictElectron === "string", `${source} missing strict Electron status`);
  assert(typeof metadata.unified === "string", `${source} missing unified status`);
  assert(typeof metadata.methodParity?.mode === "string", `${source} missing method parity mode`);
  assert(metadata.methodParity.reportPath === null || typeof metadata.methodParity.reportPath === "string", `${source} invalid method parity report path`);
  assert(metadata.methodParity.failureTotal === null || typeof metadata.methodParity.failureTotal === "number", `${source} invalid method parity total`);
};

const assertActionMetadata = ({ assert, actions, source }) => {
  const validIntents = new Set(["read", "inspect", "execute"]);
  const validRisks = new Set(["none", "low", "medium"]);
  const invalidActions = actions.filter((action) =>
    !validIntents.has(action.intent) || !validRisks.has(action.risk)
  );
  assert(invalidActions.length === 0, `${source} actions missing valid intent/risk: ${invalidActions.map((action) => action.id).join(", ")}`);
};

const assertFocusedPanelActions = ({ assert, actions, panelId, source }) => {
  if (!panelId) {
    return;
  }
  for (const action of [
    { id: "read-panel", method: "panels/get", input: { id: panelId } },
    { id: "rename-panel", method: "panels/rename", input: { id: panelId } },
    { id: "remove-panel", method: "panels/remove", input: { id: panelId } }
  ]) {
    assert(hasActionAffordance(actions, action), `${source} missing focused ${action.id} action`);
  }
};

const assertSameModuleIds = ({ assert, actual, expected, source }) => {
  const actualIds = actual.map((module) => module.id).sort();
  const expectedIds = [...expected].sort();
  assert(JSON.stringify(actualIds) === JSON.stringify(expectedIds), `${source} module ids do not match runtime/modules`);
};

const assertSameModuleAvailability = ({ assert, actual, expected, source }) => {
  const actualAvailability = availabilityById(actual);
  const expectedAvailability = availabilityById(expected);
  assert(stableJson(actualAvailability) === stableJson(expectedAvailability), `${source} module availability does not match runtime/modules`);
};

const availabilityById = (modules) =>
  Object.fromEntries(modules.map((module) => [module.id, module.availability]));

const assertKnownMethodReferences = ({ assert, references, methodIds, source }) => {
  const unknown = references
    .map((reference) => reference.method)
    .filter((method) => typeof method === "string" && !methodIds.has(method));
  assert(unknown.length === 0, `${source} reference unknown methods: ${unknown.join(", ")}`);
};
