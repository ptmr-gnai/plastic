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

const capture = async () => {
  const state = await rpc("plastic/state");
  const methods = await rpc("plastic/methods");
  return {
    capturedAt: new Date().toISOString(),
    rpcUrl,
    mode: state.app?.mode ?? "unknown",
    methodCount: methods.length,
    methods: methods.map((method) => ({
      id: method.id,
      title: method.title,
      owner: method.owner,
      availability: method.availability
    })).sort((left, right) => left.id.localeCompare(right.id))
  };
};

const compare = (base, current) => {
  const baseIds = methodIds(base.methods);
  const currentIds = methodIds(current.methods);
  const missing = baseIds.filter((id) => !currentIds.includes(id));
  const added = currentIds.filter((id) => !baseIds.includes(id));
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
  return { missing, added, ownerDrift };
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
      comparison.ownerDrift.length ? `owner drift: ${comparison.ownerDrift.map((item) => item.id).join(", ")}` : null
    ].filter(Boolean);
    if (failures.length > 0) {
      throw new Error(`Method parity failed between ${base.mode} and ${current.mode}: ${failures.join("; ")}`);
    }
  }
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(current, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ok: true, mode: current.mode, methods: current.methodCount, comparison }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
