import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const rpcUrl = process.env.PLASTIC_RPC_URL ?? "http://127.0.0.1:7331/rpc";
const outPath = process.env.PLASTIC_METHOD_PARITY_OUT;
const basePath = process.env.PLASTIC_METHOD_PARITY_BASE;

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

const capture = async () => {
  const state = await rpc("plastic/state");
  const methods = await rpc("plastic/methods");
  const modules = await rpc("runtime/modules");
  return {
    capturedAt: new Date().toISOString(),
    rpcUrl,
    mode: state.app?.mode ?? "unknown",
    methodCount: methods.length,
    moduleCount: modules.count,
    methods: methods.map((method) => ({
      id: method.id,
      title: method.title,
      owner: method.owner,
      availability: method.availability
    })).sort((left, right) => left.id.localeCompare(right.id)),
    modules: modules.items.map((module) => ({
      id: module.id,
      order: module.order,
      methodIds: [...module.methodIds].sort()
    })).sort((left, right) => left.order - right.order)
  };
};

const compare = (base, current) => {
  const baseIds = methodIds(base.methods);
  const currentIds = methodIds(current.methods);
  const missing = baseIds.filter((id) => !currentIds.includes(id));
  const added = currentIds.filter((id) => !baseIds.includes(id));
  const baseModuleIds = base.modules.map((module) => module.id);
  const currentModuleIds = current.modules.map((module) => module.id);
  const missingModules = baseModuleIds.filter((id) => !currentModuleIds.includes(id));
  const addedModules = currentModuleIds.filter((id) => !baseModuleIds.includes(id));
  const moduleOrderDrift = JSON.stringify(baseModuleIds) === JSON.stringify(currentModuleIds)
    ? []
    : [{ base: baseModuleIds, current: currentModuleIds }];
  const baseModules = modulesById(base.modules);
  const currentModules = modulesById(current.modules);
  const moduleMethodDrift = baseModuleIds
    .filter((id) => currentModules[id])
    .filter((id) => JSON.stringify(baseModules[id].methodIds) !== JSON.stringify(currentModules[id].methodIds))
    .map((id) => ({
      id,
      base: baseModules[id].methodIds,
      current: currentModules[id].methodIds
    }));
  const baseMethods = byId(base.methods);
  const currentMethods = byId(current.methods);
  const ownerDrift = baseIds
    .filter((id) => currentMethods[id])
    .filter((id) => JSON.stringify(baseMethods[id].owner) !== JSON.stringify(currentMethods[id].owner))
    .map((id) => ({
      id,
      base: baseMethods[id].owner,
      current: currentMethods[id].owner
    }));
  return { missing, added, ownerDrift, missingModules, addedModules, moduleOrderDrift, moduleMethodDrift };
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
      comparison.moduleMethodDrift.length ? `module method drift: ${comparison.moduleMethodDrift.map((item) => item.id).join(", ")}` : null
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
    comparison
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
