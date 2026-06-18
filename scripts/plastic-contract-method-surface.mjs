import { assertActionInputLegibility, assertLinkInputLegibility } from "./plastic-contract-affordances.mjs";
import { stableJson } from "./plastic-stable-json.mjs";

const codexAliasMethodIds = new Set([
  "codex/threadStart",
  "codex/threadResume",
  "codex/threadFork",
  "codex/threadList",
  "codex/threadRead",
  "codex/threadArchive",
  "codex/threadNameSet",
  "codex/turnStart",
  "codex/turnSteer",
  "codex/turnInterrupt",
  "codex/modelList",
  "codex/configRead"
]);

const descriptionOnlyOutputMethodIds = new Set([
  "rpc/call",
  "chats/interrupt",
  "codex/initialize",
  "codex/request",
  "deixis/evalDom",
  ...codexAliasMethodIds
]);

export function assertMethodCatalogsMatch({ assert, actual, expected, actualLabel, expectedLabel }) {
  assert(
    stableJson(actual) === stableJson(expected),
    `${actualLabel} method catalog diverged from ${expectedLabel}`
  );
}

export function assertMethodCatalogSurface({ assert, label, methods }) {
  const methodIds = new Set(methods.map((method) => method.id));
  const methodsById = Object.fromEntries(methods.map((method) => [method.id, method]));
  for (const method of methods) {
    assert(method.description, `${label} ${method.id} missing description`);
    assert(method.inputSchema, `${label} ${method.id} missing inputSchema`);
    assert(method.outputSchema, `${label} ${method.id} missing outputSchema`);
    assert(method.effects, `${label} ${method.id} missing effects`);
    assert(method.reversibility, `${label} ${method.id} missing reversibility`);
    assertOpenSchemaBoundaries({ assert, method, label });
    const describeLinks = (method.links ?? []).filter((link) => link.rel === "describe" && link.method === "methods/describe" && link.target === method.id);
    const invokeLinks = (method.links ?? []).filter((link) => link.rel === "invoke" && link.method === "rpc/call" && link.target === method.id);
    assert(describeLinks.length === 1, `${label} ${method.id} must expose exactly one describe link`);
    assert(invokeLinks.length === 1, `${label} ${method.id} must expose exactly one invoke link`);
    assert(
      describeLinks.some((link) => link.href === "methods/describe" && link.input?.id === method.id),
      `${label} ${method.id} missing describe link with concrete input`
    );
    assert(
      invokeLinks.some((link) => link.href === "rpc/call" && link.input?.method === method.id),
      `${label} ${method.id} missing invoke link with concrete input`
    );
    assert(
      invokeLinks.some((link) => stableJson(link.inputSchema) === stableJson(method.inputSchema)),
      `${label} ${method.id} invoke link missing delegated input schema`
    );
    assert(methodsById["methods/describe"]?.availability?.status === "available", `${label} ${method.id} describe link method is not available`);
    assert(methodsById["rpc/call"]?.availability?.status === "available", `${label} ${method.id} invoke link method is not available`);
    const unknownLinkMethods = (method.links ?? [])
      .filter((link) => typeof link.method === "string" && !methodIds.has(link.method))
      .map((link) => `${link.rel}:${link.method}`);
    assert(
      unknownLinkMethods.length === 0,
      `${label} ${method.id} links reference unknown methods: ${unknownLinkMethods.join(", ")}`
    );
    assertLinkInputLegibility({
      assert,
      links: method.links ?? [],
      methods,
      source: `${label} ${method.id} links`
    });
    const exampleActions = (method.examples ?? [])
      .map((example, index) => ({ id: `example:${index}:invoke`, method: method.id, input: example.input }));
    assertActionInputLegibility({ assert, actions: exampleActions, methods, source: `${label} ${method.id} example inputs` });
    const verifyActions = (method.examples ?? [])
      .map((example, index) => example.verifyWith ? { id: `example:${index}:verify`, ...example.verifyWith } : null)
      .filter(Boolean);
    const unknownVerifyMethods = verifyActions
      .filter((action) => typeof action.method === "string" && !methodIds.has(action.method))
      .map((action) => `${method.id}:${action.id}:${action.method}`);
    assert(
      unknownVerifyMethods.length === 0,
      `${label} ${method.id} examples verify unknown methods: ${unknownVerifyMethods.join(", ")}`
    );
    assertActionInputLegibility({ assert, actions: verifyActions, methods, source: `${label} ${method.id} examples` });
    const durableEvents = method.effects?.durableEvents ?? [];
    const allowsDynamicEvents = durableEvents.includes("<input.type>") || durableEvents.includes("delegated");
    const undeclaredExpectedEvents = (method.examples ?? [])
      .flatMap((example) => example.expectedEvents ?? [])
      .filter((eventType) => !allowsDynamicEvents && !durableEvents.includes(eventType));
    assert(
      undeclaredExpectedEvents.length === 0,
      `${label} ${method.id} examples expect undeclared durable events: ${undeclaredExpectedEvents.join(", ")}`
    );
  }
}

function assertOpenSchemaBoundaries({ assert, method, label }) {
  if (method.inputSchema?.additionalProperties === true) {
    assert(
      codexAliasMethodIds.has(method.id),
      `${label} ${method.id} input schema uses additionalProperties outside delegated Codex alias boundary`
    );
  }

  const output = method.outputSchema;
  const descriptionOnlyOutput = Boolean(output?.description) && output.type === undefined && output.properties === undefined && output.required === undefined;
  if (descriptionOnlyOutput) {
    assert(
      descriptionOnlyOutputMethodIds.has(method.id),
      `${label} ${method.id} output schema is description-only outside delegated/open result boundary`
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

export async function assertRpcCallDispatch({ assert, rpc, runId, validationMeta }) {
  const panelsDescription = await rpc("methods/describe", { id: "panels/list" });
  const describeLink = panelsDescription.links?.find((link) => link.rel === "describe" && link.target === "panels/list");
  const invokeLink = panelsDescription.links?.find((link) => link.rel === "invoke" && link.target === "panels/list");
  assert(describeLink, "panels/list missing generated describe link");
  assert(invokeLink, "panels/list missing generated invoke link");
  const linkedDescription = await rpc(describeLink.method, describeLink.input);
  assert(linkedDescription.id === panelsDescription.id, "generated describe link returned wrong method");
  const panels = await rpc(invokeLink.method, { ...invokeLink.input, input: {} });
  assert(Array.isArray(panels), "rpc/call panels/list did not return panel array");
  const describeMethodDescription = await rpc("methods/describe", { id: "methods/describe" });
  const describeInvokeLink = describeMethodDescription.links?.find((link) => link.rel === "invoke" && link.target === "methods/describe");
  assert(describeInvokeLink, "methods/describe missing generated invoke link");
  const delegatedDescription = await rpc(describeInvokeLink.method, { ...describeInvokeLink.input, input: { id: "panels/list" } });
  assert(delegatedDescription.id === panelsDescription.id, "generated methods/describe invoke link returned wrong method");
  const type = "contract.rpc_call.appended";
  const marker = `${runId}-rpc-call`;
  const appendDescription = await rpc("methods/describe", { id: "events/append" });
  const appendInvokeLink = appendDescription.links?.find((link) => link.rel === "invoke" && link.target === "events/append");
  assert(appendInvokeLink, "events/append missing generated invoke link");
  const event = await rpc(appendInvokeLink.method, {
    ...appendInvokeLink.input,
    input: { type, payload: { marker }, scope: { workspaceId: "default" }, meta: validationMeta }
  });
  assert(event?.type === type, "rpc/call events/append returned wrong event type");
  assert(event.payload?.marker === marker, "rpc/call events/append payload mismatch");
  const events = await rpc("events/list", { types: [type], limit: 25 });
  assert(Array.isArray(events), "rpc/call follow-up events/list did not return array");
  assert(events.some((item) => item.id === event.id && item.payload?.marker === marker), "rpc/call appended event was not durable");
  try {
    await rpc("rpc/call", { method: "rpc/call", input: {} });
    throw new Error("rpc/call unexpectedly called itself");
  } catch (error) {
    assert(String(error.message ?? error).includes("cannot call itself"), "rpc/call self-call error mismatch");
  }
  return { delegatedMethods: ["panels/list", "methods/describe", "events/append"], panels: panels.length, eventId: event.id };
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
  assert(schema?.properties?.links?.items?.required?.includes("rel"), `${label} links schema must require rel`);
  assert(schema?.properties?.links?.items?.required?.includes("href"), `${label} links schema must require href`);
  assert(schema?.properties?.links?.items?.properties?.inputSchema, `${label} links schema must expose inputSchema`);
  assert(schema?.properties?.examples?.items?.required?.includes("title"), `${label} examples schema must require title`);
  assert(schema?.properties?.examples?.items?.properties?.expectedEvents?.items?.type === "string", `${label} examples schema must expose expected event types`);
  assert(schema?.properties?.examples?.items?.properties?.verifyWith?.required?.includes("method"), `${label} examples schema must expose verification method`);
}
