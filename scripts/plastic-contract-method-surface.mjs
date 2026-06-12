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
