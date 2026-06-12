import type { PlasticEvent } from "@plastic/core";
import { invalidControlPlaneUrls } from "./runtime-health-control-plane-checks.js";

export const checkRuntimeHostIdentityHealth = (host: unknown, events: PlasticEvent[]) => {
  const live = asRecord(host);
  const latestStarted = [...events].reverse().find((event) => event.type === "runtime.started");
  const durable = asRecord(asRecord(latestStarted?.payload).host);
  const invalidHostControlPlaneUrls = invalidControlPlaneUrls(asRecord(live.controlPlane));
  const mismatchedIdentityFields = hostIdentityFields.filter((key) => live[key] !== durable[key]);
  if (!latestStarted) {
    throw new Error("runtime.started event is missing");
  }
  if (asRecord(live.hostBase).id !== "runtime-host-base" || asRecord(live.hostBase).version !== 1) {
    throw new Error("runtime/host missing shared host base marker");
  }
  if (mismatchedIdentityFields.length > 0) {
    throw new Error(`runtime/host live identity diverged from runtime.started: ${mismatchedIdentityFields.join(", ")}`);
  }
  if (invalidHostControlPlaneUrls.length > 0) {
    throw new Error(`runtime/host control plane URLs are invalid: ${invalidHostControlPlaneUrls.join(", ")}`);
  }
  if (JSON.stringify(live.agentTransports) !== JSON.stringify(durable.agentTransports)) {
    throw new Error("runtime/host live agent transports diverged from runtime.started");
  }
  return {
    eventId: latestStarted.id,
    mode: live.mode,
    service: live.service,
    invalidHostControlPlaneUrls,
    mismatchedIdentityFields,
    agentTransportsMatch: true
  };
};

const hostIdentityFields = [
  "service",
  "mode",
  "status",
  "workspaceDir",
  "eventPath",
  "runtimeRpcUrl",
  "pid",
  "startedAt"
];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
