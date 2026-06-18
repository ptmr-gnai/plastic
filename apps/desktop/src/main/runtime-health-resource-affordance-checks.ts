import type { PlasticMethod } from "@plastic/core";

export const invalidResourceAffordances = (
  resources: Record<string, unknown>[],
  methods: PlasticMethod[],
  source: string
) => {
  const methodsById = new Map(methods.map((method) => [method.id, method]));
  return resources.flatMap((resource) =>
    [...affordances(resource.links, "link"), ...affordances(resource.actions, "action")]
      .flatMap((affordance) => invalidAffordance(resource, affordance, methodsById, source))
  );
};

const affordances = (value: unknown, kind: "link" | "action") =>
  (Array.isArray(value) ? value.map(asRecord) : []).map((affordance) => ({ ...affordance, kind }));

const invalidAffordance = (
  resource: Record<string, unknown>,
  affordance: Record<string, unknown> & { kind: "link" | "action" },
  methodsById: Map<string, PlasticMethod>,
  source: string
) => {
  if (typeof affordance.method !== "string" || affordance.method.startsWith("http/")) {
    return [];
  }
  const resourceId = String(resource.id ?? resource.kind ?? "unknown-resource");
  const affordanceId = String(affordance.id ?? affordance.rel ?? affordance.method);
  const method = methodsById.get(affordance.method);
  if (!method) {
    return [`${source}:${resourceId}:${affordanceId}:${affordance.kind}:unknown-method:${affordance.method}`];
  }
  if (
    schemaHasInputShape(method.inputSchema)
    && !inputSatisfiesRequiredFields(affordance.input, method.inputSchema)
    && !schemaHasInputShape(affordance.inputSchema)
  ) {
    return [`${source}:${resourceId}:${affordanceId}:${affordance.kind}:vague-input:${affordance.method}`];
  }
  return [];
};

const schemaHasInputShape = (schema: unknown) => {
  const record = asRecord(schema);
  return Object.keys(asRecord(record.properties)).length > 0;
};

const inputSatisfiesRequiredFields = (input: unknown, schema: unknown) => {
  const required = asRecord(schema).required;
  if (!Array.isArray(required) || required.length === 0) {
    return input !== undefined;
  }
  const inputRecord = asRecord(input);
  return required.every((field) => typeof field === "string" && inputRecord[field] !== undefined);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
