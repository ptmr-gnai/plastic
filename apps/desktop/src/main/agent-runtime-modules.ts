import type { MethodRegistry, PlasticEvent } from "@plastic/core";
import type { RunPromise } from "./runtime-method-context.js";

export const readRuntimeModules = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const modules = await input.runPromise(input.methods.call("runtime/modules", {}));
  const items = Array.isArray((modules as { items?: unknown })?.items)
    ? (modules as { items: Array<Record<string, unknown>> }).items
    : [];
  return {
    count: items.length,
    items: items.map((module) => ({
      id: module.id,
      order: module.order,
      methodCount: Array.isArray(module.methodIds) ? module.methodIds.length : 0,
      availability: module.availability
    }))
  };
};

export const readRuntimeControlPlane = (events: PlasticEvent[]): Record<string, unknown> | null => {
  const latestStarted = [...events].reverse().find((event: PlasticEvent) => event.type === "runtime.started");
  const payload = asRecord(latestStarted?.payload);
  const controlPlane = asRecord(payload.controlPlane);
  return Object.keys(controlPlane).length > 0 ? controlPlane : null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
