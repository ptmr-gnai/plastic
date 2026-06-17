import { stableJson } from "./plastic-stable-json.mjs";

export function assertMethodCatalogsMatch({ assert, actual, expected, actualLabel, expectedLabel }) {
  assert(
    stableJson(actual) === stableJson(expected),
    `${actualLabel} method catalog diverged from ${expectedLabel}`
  );
}

export function assertMethodCatalogSurface({ assert, label, methods }) {
  for (const method of methods) {
    assert(method.description, `${label} ${method.id} missing description`);
    assert(method.inputSchema, `${label} ${method.id} missing inputSchema`);
    assert(method.outputSchema, `${label} ${method.id} missing outputSchema`);
    assert(method.effects, `${label} ${method.id} missing effects`);
    assert(method.reversibility, `${label} ${method.id} missing reversibility`);
    assert(
      method.links?.some((link) => link.rel === "describe" && link.method === "methods/describe" && link.target === method.id),
      `${label} ${method.id} missing describe link`
    );
    assert(
      method.links?.some((link) => link.rel === "invoke" && link.method === "rpc/call" && link.target === method.id),
      `${label} ${method.id} missing invoke link`
    );
  }
}

export function assertPlasticMethodsMethodDescription({ assert, description }) {
  assert(description.outputSchema?.type === "array", "plastic/methods output schema must be an array");
  assertMethodSchema({ assert, schema: description.outputSchema?.items, label: "plastic/methods item" });
}

export function assertDescribeMethodDescription({ assert, description }) {
  assertMethodSchema({ assert, schema: description.outputSchema, label: "methods/describe output" });
}

export function assertRpcCallMethodDescription({ assert, description }) {
  assert(description.inputSchema?.required?.includes("method"), "rpc/call input schema must require method");
  assert(description.inputSchema?.properties?.method?.type === "string", "rpc/call input schema must expose string method");
  assert(description.inputSchema?.properties?.input, "rpc/call input schema must expose delegated input");
  assert(description.outputSchema?.description?.includes("delegated Plastic RPC"), "rpc/call output schema must describe delegated result");
  assert(description.effects?.durableEvents?.includes("delegated"), "rpc/call effects must describe delegated durable events");
  assert(description.effects?.mutatesProjection?.includes("delegated"), "rpc/call effects must describe delegated projection mutation");
  assert(description.reversibility?.reversible === false, "rpc/call must describe delegated reversibility");
  assert(description.examples?.some((example) => example.input?.method === "panels/list"), "rpc/call examples must show delegated invocation");
}

function assertMethodSchema({ assert, schema, label }) {
  assert(schema?.required?.includes("id"), `${label} schema must require id`);
  assert(schema?.required?.includes("title"), `${label} schema must require title`);
  assert(schema?.required?.includes("owner"), `${label} schema must require owner`);
  assert(schema?.required?.includes("availability"), `${label} schema must require availability`);
  assert(schema?.required?.includes("links"), `${label} schema must require links`);
  assert(schema?.properties?.owner?.required?.includes("kind"), `${label} owner schema must require kind`);
  assert(schema?.properties?.owner?.properties?.kind?.enum?.includes("runtime"), `${label} owner schema must expose runtime owner`);
  assert(schema?.properties?.availability?.required?.includes("status"), `${label} availability schema must require status`);
  assert(schema?.properties?.availability?.properties?.status?.enum?.includes("available"), `${label} availability schema must expose available status`);
  assert(schema?.properties?.availability?.properties?.status?.enum?.includes("unavailable"), `${label} availability schema must expose unavailable status`);
}
