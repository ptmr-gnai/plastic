import { stableJson } from "./plastic-stable-json.mjs";

export function assertMethodCatalogsMatch({ assert, actual, expected, actualLabel, expectedLabel }) {
  assert(
    stableJson(actual) === stableJson(expected),
    `${actualLabel} method catalog diverged from ${expectedLabel}`
  );
}

export function assertMethodCatalogSurface({ assert, label, methods }) {
  for (const method of methods) {
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
