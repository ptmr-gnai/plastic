import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeModule } from "./runtime-method-context.js";

const runtimeDiagnosticsAvailability = {
  status: "available" as const,
  notes: "Diagnostics are a shared runtime primitive backed by the current host."
};

type AuditResult = {
  id?: unknown;
  ok?: unknown;
  diagnostics?: {
    hints?: unknown;
  };
};

type AuditSummary = {
  ok?: unknown;
  runtimeUnification?: {
    usable?: unknown;
    strictElectron?: unknown;
    unified?: unknown;
    blockingFailures?: unknown;
  };
  results?: unknown;
};

const asStringArray = (value: unknown): Array<string> => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const diagnosis = (code: string, phase: string | null, summary: string) => ({ code, phase, summary });

const diagnoseFailure = (failurePhase: string | null, hints: Array<string>) => {
  if (
    failurePhase === "electron"
    && hints.some((hint) => hint.includes("electronAppModeSmokeHint"))
  ) {
    return diagnosis("electron-app-mode-smoke-not-entered", "electron-host-app-mode", "Electron app mode did not enter a minimal app main module in this host, before Plastic-specific startup was attempted.");
  }
  if (
    failurePhase === "electron"
    && hints.some((hint) => hint.includes("[plastic:entry]"))
    && !hints.some((hint) => hint.includes("[plastic:entry-preflight]"))
    && hints.some((hint) => hint.includes("no Plastic main-process startup logs"))
  ) {
    return diagnosis("electron-main-entered-startup-missing", "electron-runtime-bootstrap", "Electron entered Plastic's main module, but runtime startup logs were not observed.");
  }
  if (
    failurePhase === "electron"
    && hints.some((hint) => hint.includes("[plastic:entry-cjs]"))
    && !hints.some((hint) => hint.includes("[plastic:entry]"))
    && hints.some((hint) => hint.includes("no Plastic main-process startup logs"))
  ) {
    return diagnosis("electron-cjs-entry-entered-esm-missing", "electron-esm-main-import", "Electron entered the CommonJS package launcher, but the compiled ESM main bootstrap was not observed.");
  }
  if (
    failurePhase === "electron"
    && hints.some((hint) => hint.includes("[plastic:entry-preflight]"))
    && hints.some((hint) => hint.includes("electron-launch") && hint.includes("mode=compiled-main"))
    && hints.some((hint) => hint.includes("electron-child-status") && hint.includes("exitCode=running"))
    && hints.some((hint) => hint.includes("no Plastic main-process startup logs"))
  ) {
    return diagnosis("electron-child-running-compiled-main-not-entered", "electron-app-main-resolution", "Electron child process stayed alive with the compiled main path as its launch target, but Plastic's compiled main bootstrap was not observed in normal app mode.");
  }
  if (
    failurePhase === "electron"
    && hints.some((hint) => hint.includes("[plastic:entry-preflight]"))
    && hints.some((hint) => hint.includes("electron-launch"))
    && hints.some((hint) => hint.includes("electron-child-status") && hint.includes("exitCode=running"))
    && hints.some((hint) => hint.includes("no Plastic main-process startup logs"))
  ) {
    return diagnosis("electron-child-running-main-not-entered", "electron-app-main-resolution", "Electron child process stayed alive, but neither the CommonJS package launcher nor compiled main bootstrap was observed.");
  }
  if (
    failurePhase === "electron"
    && hints.some((hint) => hint.includes("[plastic:entry-preflight]"))
    && hints.some((hint) => hint.includes("electron-launch"))
    && hints.some((hint) => hint.includes("no Plastic main-process startup logs"))
  ) {
    return diagnosis("electron-app-main-not-entered", "electron-app-main-resolution", "The compiled Electron main bootstrap is runnable, but Electron app launch did not observe the main entry.");
  }
  if (
    failurePhase === "electron"
    && hints.some((hint) => hint.includes("electron-main-ready"))
    && hints.some((hint) => hint.includes("electron-launch"))
    && hints.some((hint) => hint.includes("no Plastic main-process startup logs"))
  ) {
    return diagnosis("electron-main-entry-not-observed", "electron-main-entry", "The Electron main bundle existed and Electron was launched, but Plastic main-process startup logs were not observed.");
  }
  if (failurePhase === "electron" && hints.some((hint) => hint.includes("no Plastic main-process startup logs"))) {
    return diagnosis("electron-main-startup-missing", "electron-main-process-startup", "Electron launched, but Plastic main-process startup was not observed before runtime ports became ready.");
  }
  if (failurePhase === "electron" && hints.some((hint) => hint.includes("7331") || hint.includes("7332"))) {
    return diagnosis("electron-runtime-ports-missing", "electron-runtime-port-binding", "Electron validation did not observe the runtime/build HTTP ports.");
  }
  if (failurePhase) {
    return diagnosis(`${failurePhase}-validation-failed`, failurePhase, `The ${failurePhase} validation step failed.`);
  }
  return diagnosis("none", null, "No failed validation step was found.");
};

const buildAuditVerdict = (summary: AuditSummary | null) => {
  if (!summary) {
    return {
      status: "missing",
      usable: false,
      strictElectron: "not-run",
      unified: "not-run",
      failurePhase: null,
      diagnosis: {
        code: "audit-missing",
        phase: null,
        summary: "No runtime unification audit has been written yet."
      },
      hints: [],
      nextAction: "Run pnpm plastic:audit-runtime-unification to create a runtime unification audit."
    };
  }

  const results = Array.isArray(summary.results) ? summary.results as Array<AuditResult> : [];
  const firstFailed = results.find((result) => result.ok === false);
  const hints = asStringArray(firstFailed?.diagnostics?.hints);
  const strictElectron = typeof summary.runtimeUnification?.strictElectron === "string" ? summary.runtimeUnification.strictElectron : "unknown";
  const unified = typeof summary.runtimeUnification?.unified === "string" ? summary.runtimeUnification.unified : "unknown";
  const usable = summary.runtimeUnification?.usable === true;
  const status = usable ? strictElectron === "passed" && unified === "passed" ? "passed" : "degraded" : "failed";
  const failurePhase = typeof firstFailed?.id === "string" ? firstFailed.id : null;
  const diagnosis = diagnoseFailure(failurePhase, hints);
  const nextAction = failurePhase === "electron"
    ? "Investigate Electron launch before Plastic main-process startup; compare host output, port listeners, and runtime startup logs."
    : failurePhase
      ? `Fix the ${failurePhase} validation failure, then rerun pnpm plastic:audit-runtime-unification.`
      : usable
        ? "Continue closing headed/headless runtime gaps; strict Electron is the remaining proof when degraded."
        : "Rerun pnpm plastic:audit-runtime-unification and inspect failed check diagnostics.";

  return { status, usable, strictElectron, unified, failurePhase, diagnosis, hints, nextAction };
};

export const createRuntimeDiagnosticsModule = (input: {
  getDiagnostics: () => unknown;
  plasticDir: string;
}): RuntimeModule => ({
  id: "runtime-diagnostics",
  register: async ({ methods, runPromise }) => {
    await runPromise(
      methods.register({
        id: "app/diagnostics",
        title: "App diagnostics",
        description: "Returns runtime host diagnostics for the current Plastic process.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeDiagnosticsAvailability,
        inputSchema: noInputSchema,
        examples: [
          {
            title: "Read host diagnostics",
            input: {},
            verifyWith: { method: "plastic/state", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () => Effect.sync(input.getDiagnostics)
      })
    );

    await runPromise(
      methods.register({
        id: "runtime/auditStatus",
        title: "Runtime audit status",
        description: "Returns the latest persisted runtime unification audit summary, when one has been written.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeDiagnosticsAvailability,
        inputSchema: noInputSchema,
        examples: [
          {
            title: "Read latest runtime audit verdict",
            input: {},
            verifyWith: { method: "app/diagnostics", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () =>
          Effect.promise(async () => {
            const path = join(input.plasticDir, "tmp", "runtime-unification-audit.json");
            try {
              const summary = JSON.parse(await readFile(path, "utf8")) as AuditSummary;
              return { available: true, path, verdict: buildAuditVerdict(summary), summary };
            } catch (error) {
              const code = (error as { code?: string }).code;
              if (code === "ENOENT") {
                return { available: false, path, verdict: buildAuditVerdict(null), summary: null };
              }
              throw error;
            }
          })
      })
    );
  }
});
