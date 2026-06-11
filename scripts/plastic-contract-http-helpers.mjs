import { assert, buildUrl, runtimeUrl } from "./plastic-contract-helpers.mjs";

const rawJsonRequest = async (baseUrl, path, init, label) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let payload = {};
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`${label} ${path}: response was not JSON`);
    }
  }
  return { response, payload };
};

export const rawRuntimeRequest = (path, init = {}) => rawJsonRequest(runtimeUrl, path, init, "runtime");
export const rawBuildRequest = (path, init = {}) => rawJsonRequest(buildUrl, path, init, "build");

export const assertHttpErrorContract = async ({ label, rawRequest, runId }) => {
  const preflight = await rawRequest("/rpc", {
    method: "OPTIONS",
    headers: { origin: "http://127.0.0.1:5173" }
  });
  assert(preflight.response.status === 204, `${label} OPTIONS /rpc did not return 204`);
  assert(preflight.payload.ok !== false, `${label} OPTIONS /rpc returned error payload`);

  const unknownGet = await rawRequest("/does-not-exist");
  assert(unknownGet.response.status === 404, `${label} unknown GET did not return 404`);
  assert(unknownGet.payload.ok === false, `${label} unknown GET missing ok:false`);
  assert(unknownGet.payload.error === "Not found", `${label} unknown GET error mismatch`);

  const missingMethod = await rawRequest("/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert(missingMethod.response.status === 500, `${label} missing method did not return 500`);
  assert(missingMethod.payload.ok === false, `${label} missing method missing ok:false`);
  assert(missingMethod.payload.error.includes("requires method"), `${label} missing method error mismatch`);

  const unknownMethod = await rawRequest("/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: `contract/missing-${runId}` })
  });
  assert(unknownMethod.response.status === 500, `${label} unknown RPC method did not return 500`);
  assert(unknownMethod.payload.ok === false, `${label} unknown RPC method missing ok:false`);
  assert(unknownMethod.payload.error.includes("not found"), `${label} unknown RPC method error mismatch`);

  return {
    preflight: preflight.response.status,
    unknownGet: unknownGet.response.status,
    missingMethod: missingMethod.response.status,
    unknownMethod: unknownMethod.response.status
  };
};
