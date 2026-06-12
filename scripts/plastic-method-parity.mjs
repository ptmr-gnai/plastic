import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createPlasticMcpClient } from "./plastic-mcp-client.mjs";
import { stableValue } from "./plastic-stable-json.mjs";

const rpcUrl = process.env.PLASTIC_RPC_URL ?? "http://127.0.0.1:7331/rpc";
const outPath = process.env.PLASTIC_METHOD_PARITY_OUT;
const basePath = process.env.PLASTIC_METHOD_PARITY_BASE;
const mcpToolTimeoutMs = Number(process.env.PLASTIC_METHOD_PARITY_MCP_TIMEOUT_MS ?? "3000");

const rpc = async (method, input = {}) => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, input })
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `${method} failed with ${response.status}`);
  }
  return payload.value;
};

const methodIds = (methods) => methods.map((method) => method.id).sort();

const byId = (methods) => Object.fromEntries(methods.map((method) => [method.id, method]));
const modulesById = (modules) => Object.fromEntries(modules.map((module) => [module.id, module]));
const capabilitiesById = (capabilities) => Object.fromEntries(capabilities.map((capability) => [capability.id, capability]));
const sorted = (values) => [...(values ?? [])].sort();
const sharedHealthCheckIds = [
  "event-store:list",
  "methods:list",
  "capabilities:list",
  "runtime-modules:map",
  "runtime-audit:status",
  "panels:project",
  "windows:project",
  "extensions:project"
];
const serviceAffordances = (state) => (state.resources ?? [])
  .filter((resource) => resource.kind === "service")
  .reduce(
    (surface, resource) => ({
      links: sorted([...surface.links, ...(resource.links ?? []).map((link) => `${link.rel}:${link.method}`)]),
      actions: sorted([...surface.actions, ...(resource.actions ?? []).map((action) => `${action.id}:${action.method}`)])
    }),
    { links: [], actions: [] }
  );
const snapshotAffordances = (snapshot) => sorted((snapshot.links ?? []).map((link) => `${link.rel}:${link.method}`));
const transportShape = (transport) => stableValue({
  id: transport.id,
  status: transport.status,
  transport: transport.transport,
  methodRegistry: transport.methodRegistry,
  command: transport.command,
  args: transport.args,
  envKeys: sorted(Object.keys(transport.env ?? {})),
  links: transport.links,
  actions: transport.actions,
  tools: transport.tools
});
const hostShape = (host) => ({
  hostBase: stableValue(host.hostBase),
  status: host.status,
  agentTransports: stableValue((host.agentTransports ?? []).map(transportShape).sort((left, right) => left.id.localeCompare(right.id))),
  controlPlane: {
    runtime: stableValue({
      transport: host.controlPlane?.runtime?.transport,
      rpcPath: host.controlPlane?.runtime?.rpcPath,
      statePath: host.controlPlane?.runtime?.statePath,
      methodsPath: host.controlPlane?.runtime?.methodsPath,
      hostPath: host.controlPlane?.runtime?.hostPath,
      capabilitiesPath: host.controlPlane?.runtime?.capabilitiesPath,
      snapshotPath: host.controlPlane?.runtime?.snapshotPath,
      eventStreamPath: host.controlPlane?.runtime?.eventStreamPath,
      healthPath: host.controlPlane?.runtime?.healthPath
    }),
    build: stableValue({
      transport: host.controlPlane?.build?.transport,
      rpcPath: host.controlPlane?.build?.rpcPath,
      statePath: host.controlPlane?.build?.statePath,
      methodsPath: host.controlPlane?.build?.methodsPath,
      hostPath: host.controlPlane?.build?.hostPath,
      capabilitiesPath: host.controlPlane?.build?.capabilitiesPath,
      snapshotPath: host.controlPlane?.build?.snapshotPath,
      eventStreamPath: host.controlPlane?.build?.eventStreamPath,
      healthPath: host.controlPlane?.build?.healthPath,
      statusPath: host.controlPlane?.build?.statusPath
    })
  }
});
const healthShape = (selfTest) => {
  const checks = Array.isArray(selfTest?.checks) ? selfTest.checks : [];
  const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
  return {
    ok: selfTest?.ok === true,
    checkIds: sorted(checks.map((check) => check.id)),
    sharedChecks: sharedHealthCheckIds.map((id) => ({
      id,
      ok: byId[id]?.ok === true
    }))
  };
};

const readMcpTools = async (host) => {
  const transport = host.agentTransports?.find((item) => item.id === "mcp-stdio");
  if (!transport) {
    return [];
  }
  const mcp = createPlasticMcpClient({
    command: transport.command,
    args: transport.args ?? [],
    env: transport.env ?? {},
    timeoutMs: mcpToolTimeoutMs
  });
  try {
    await mcp.initialize();
    const tools = await mcp.listTools();
    return tools.map(mcpToolShape).sort((left, right) => left.name.localeCompare(right.name));
  } finally {
    mcp.close();
  }
};

const mcpToolShape = (tool) => stableValue({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema
});

const methodMetadataFields = [
  "title",
  "description",
  "inputSchema",
  "outputSchema",
  "examples",
  "effects",
  "preconditions",
  "reversibility",
  "permissions",
  "links"
];

const capture = async () => {
  const state = await rpc("plastic/state");
  const snapshot = await rpc("plastic/snapshot");
  const host = await rpc("runtime/host");
  const methods = await rpc("plastic/methods");
  const modules = await rpc("runtime/modules");
  const capabilities = await rpc("runtime/capabilities");
  const selfTest = await rpc("plastic/selfTest");
  const mcpTools = await readMcpTools(host);
  return {
    capturedAt: new Date().toISOString(),
    rpcUrl,
    mode: state.app?.mode ?? "unknown",
    host: hostShape(host),
    health: healthShape(selfTest),
    discovery: {
      serviceResources: serviceAffordances(state),
      snapshotLinks: snapshotAffordances(snapshot)
    },
    mcpTools,
    methodCount: methods.length,
    moduleCount: modules.count,
    capabilityCount: capabilities.count,
    healthCheckCount: selfTest.checks?.length ?? 0,
    methods: methods.map((method) => ({
      id: method.id,
      title: method.title,
      description: method.description,
      inputSchema: stableValue(method.inputSchema),
      outputSchema: stableValue(method.outputSchema),
      examples: stableValue(method.examples),
      effects: stableValue(method.effects),
      preconditions: stableValue(method.preconditions),
      reversibility: stableValue(method.reversibility),
      permissions: sorted(method.permissions),
      links: stableValue(method.links),
      owner: method.owner,
      requiredCapabilities: sorted(method.availability?.requiredCapabilities)
    })).sort((left, right) => left.id.localeCompare(right.id)),
    modules: modules.items.map((module) => ({
      id: module.id,
      order: module.order,
      methodIds: [...module.methodIds].sort()
    })).sort((left, right) => left.order - right.order),
    capabilities: capabilities.items.map((capability) => ({
      id: capability.id,
      title: capability.title
    })).sort((left, right) => left.id.localeCompare(right.id))
  };
};

const compare = (base, current) => {
  const baseIds = methodIds(base.methods);
  const currentIds = methodIds(current.methods);
  const missing = baseIds.filter((id) => !currentIds.includes(id));
  const added = currentIds.filter((id) => !baseIds.includes(id));
  const moduleDrift = compareModules(base.modules, current.modules);
  const capabilityDrift = compareCapabilities(base.capabilities, current.capabilities);
  const methodDrift = compareMethodMetadata({ baseIds, baseMethods: byId(base.methods), currentMethods: byId(current.methods) });
  const healthDrift = compareHealth(base.health, current.health);
  return {
    missing,
    added,
    ownerDrift: methodDrift.ownerDrift,
    ...moduleDrift,
    ...capabilityDrift,
    hostShapeDrift: JSON.stringify(base.host) === JSON.stringify(current.host) ? [] : [{ base: base.host, current: current.host }],
    healthDrift,
    discoveryDrift: JSON.stringify(base.discovery) === JSON.stringify(current.discovery) ? [] : [{ base: base.discovery, current: current.discovery }],
    mcpToolDrift: JSON.stringify(base.mcpTools) === JSON.stringify(current.mcpTools) ? [] : [{ base: base.mcpTools, current: current.mcpTools }],
    methodCapabilityDrift: methodDrift.methodCapabilityDrift,
    methodMetadataDrift: methodDrift.methodMetadataDrift
  };
};

const compareHealth = (baseHealth, currentHealth) => {
  const failures = [];
  if (!baseHealth?.ok || !currentHealth?.ok) {
    failures.push({ id: "plastic/selfTest", base: baseHealth?.ok === true, current: currentHealth?.ok === true });
  }
  const baseShared = Object.fromEntries((baseHealth?.sharedChecks ?? []).map((check) => [check.id, check.ok]));
  const currentShared = Object.fromEntries((currentHealth?.sharedChecks ?? []).map((check) => [check.id, check.ok]));
  for (const id of sharedHealthCheckIds) {
    if (baseShared[id] !== true || currentShared[id] !== true) {
      failures.push({ id, base: baseShared[id] === true, current: currentShared[id] === true });
    }
  }
  return failures;
};

const compareModules = (baseModulesList, currentModulesList) => {
  const baseModuleIds = baseModulesList.map((module) => module.id);
  const currentModuleIds = currentModulesList.map((module) => module.id);
  const baseModules = modulesById(baseModulesList);
  const currentModules = modulesById(currentModulesList);
  return {
    missingModules: baseModuleIds.filter((id) => !currentModuleIds.includes(id)),
    addedModules: currentModuleIds.filter((id) => !baseModuleIds.includes(id)),
    moduleOrderDrift: JSON.stringify(baseModuleIds) === JSON.stringify(currentModuleIds)
      ? []
      : [{ base: baseModuleIds, current: currentModuleIds }],
    moduleMethodDrift: baseModuleIds
      .filter((id) => currentModules[id])
      .filter((id) => JSON.stringify(baseModules[id].methodIds) !== JSON.stringify(currentModules[id].methodIds))
      .map((id) => ({ id, base: baseModules[id].methodIds, current: currentModules[id].methodIds }))
  };
};

const compareCapabilities = (baseCapabilitiesList, currentCapabilitiesList) => {
  const baseCapabilityIds = baseCapabilitiesList.map((capability) => capability.id);
  const currentCapabilityIds = currentCapabilitiesList.map((capability) => capability.id);
  const baseCapabilities = capabilitiesById(baseCapabilitiesList);
  const currentCapabilities = capabilitiesById(currentCapabilitiesList);
  return {
    missingCapabilities: baseCapabilityIds.filter((id) => !currentCapabilityIds.includes(id)),
    addedCapabilities: currentCapabilityIds.filter((id) => !baseCapabilityIds.includes(id)),
    capabilityTitleDrift: baseCapabilityIds
      .filter((id) => currentCapabilities[id])
      .filter((id) => baseCapabilities[id].title !== currentCapabilities[id].title)
      .map((id) => ({ id, base: baseCapabilities[id].title, current: currentCapabilities[id].title }))
  };
};

const compareMethodMetadata = ({ baseIds, baseMethods, currentMethods }) => {
  const ownerDrift = baseIds
    .filter((id) => currentMethods[id])
    .filter((id) => JSON.stringify(baseMethods[id].owner) !== JSON.stringify(currentMethods[id].owner))
    .map((id) => ({
      id,
      base: baseMethods[id].owner,
      current: currentMethods[id].owner
    }));
  const methodCapabilityDrift = baseIds
    .filter((id) => currentMethods[id])
    .filter((id) => JSON.stringify(baseMethods[id].requiredCapabilities) !== JSON.stringify(currentMethods[id].requiredCapabilities))
    .map((id) => ({
      id,
      base: baseMethods[id].requiredCapabilities,
      current: currentMethods[id].requiredCapabilities
    }));
  const methodMetadataDrift = methodMetadataFields.flatMap((field) =>
    baseIds
      .filter((id) => currentMethods[id])
      .filter((id) => JSON.stringify(baseMethods[id][field]) !== JSON.stringify(currentMethods[id][field]))
      .map((id) => ({
        id,
        field,
        base: baseMethods[id][field],
        current: currentMethods[id][field]
      }))
  );
  return {
    ownerDrift,
    methodCapabilityDrift,
    methodMetadataDrift
  };
};

const main = async () => {
  const current = await capture();
  let comparison = null;
  if (basePath) {
    const base = JSON.parse(await readFile(basePath, "utf8"));
    comparison = compare(base, current);
    const failures = [
      comparison.missing.length ? `missing methods: ${comparison.missing.join(", ")}` : null,
      comparison.added.length ? `added methods: ${comparison.added.join(", ")}` : null,
      comparison.ownerDrift.length ? `owner drift: ${comparison.ownerDrift.map((item) => item.id).join(", ")}` : null,
      comparison.missingModules.length ? `missing modules: ${comparison.missingModules.join(", ")}` : null,
      comparison.addedModules.length ? `added modules: ${comparison.addedModules.join(", ")}` : null,
      comparison.moduleOrderDrift.length ? "module order drift" : null,
      comparison.moduleMethodDrift.length ? `module method drift: ${comparison.moduleMethodDrift.map((item) => item.id).join(", ")}` : null,
      comparison.missingCapabilities.length ? `missing capabilities: ${comparison.missingCapabilities.join(", ")}` : null,
      comparison.addedCapabilities.length ? `added capabilities: ${comparison.addedCapabilities.join(", ")}` : null,
      comparison.capabilityTitleDrift.length ? `capability title drift: ${comparison.capabilityTitleDrift.map((item) => item.id).join(", ")}` : null,
      comparison.hostShapeDrift.length ? "host shape drift" : null,
      comparison.healthDrift.length ? `health drift: ${comparison.healthDrift.map((item) => item.id).join(", ")}` : null,
      comparison.discoveryDrift.length ? "discovery affordance drift" : null,
      comparison.mcpToolDrift.length ? "MCP tool metadata drift" : null,
      comparison.methodCapabilityDrift.length ? `method capability drift: ${comparison.methodCapabilityDrift.map((item) => item.id).join(", ")}` : null,
      comparison.methodMetadataDrift.length ? `method metadata drift: ${comparison.methodMetadataDrift.map((item) => `${item.id}.${item.field}`).join(", ")}` : null
    ].filter(Boolean);
    if (failures.length > 0) {
      throw new Error(`Method parity failed between ${base.mode} and ${current.mode}: ${failures.join("; ")}`);
    }
  }
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(current, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    ok: true,
    mode: current.mode,
    methods: current.methodCount,
    modules: current.moduleCount,
    capabilities: current.capabilityCount,
    healthChecks: current.healthCheckCount,
    sharedHealthChecks: current.health.sharedChecks.map((check) => check.id),
    mcpTools: current.mcpTools.map((tool) => tool.name),
    comparison
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
