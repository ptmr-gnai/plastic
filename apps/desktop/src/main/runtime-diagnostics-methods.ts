import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MethodRegistry } from "@plastic/core";
import { Effect } from "effect";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeCommandResult } from "./runtime-build-methods.js";
import type { AppendEvent, RunPromise, RuntimeModule } from "./runtime-method-context.js";

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

type DiagnosticAction = {
  id: string;
  title: string;
  command: string;
  run: {
    command: string;
    args: Array<string>;
    env?: Record<string, string>;
  };
  description: string;
  method: "runtime/runAuditAction";
  input: { id: string };
};

const auditAction = (action: Omit<DiagnosticAction, "method" | "input">): DiagnosticAction => ({
  ...action,
  method: "runtime/runAuditAction",
  input: { id: action.id }
});

const asStringArray = (value: unknown): Array<string> => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const diagnosis = (code: string, phase: string | null, summary: string) => ({ code, phase, summary });

const diagnosticActionsFor = (diagnosisResult: ReturnType<typeof diagnosis>): Array<DiagnosticAction> => {
  if (diagnosisResult.code === "audit-missing") {
    return [
      auditAction({
        id: "run-runtime-unification-audit",
        title: "Run runtime unification audit",
        command: "pnpm plastic:audit-runtime-unification",
        run: { command: "pnpm", args: ["plastic:audit-runtime-unification"] },
        description: "Creates the persisted headed/headless audit that runtime/auditStatus reads."
      })
    ];
  }
  if (diagnosisResult.code === "electron-app-mode-smoke-not-entered") {
    return [
      auditAction({
        id: "force-full-electron-launch-diagnostics",
        title: "Force full Electron launch diagnostics",
        command: "PLASTIC_ELECTRON_SKIP_APP_MODE_SMOKE=1 pnpm plastic:validate-electron",
        run: { command: "pnpm", args: ["plastic:validate-electron"], env: { PLASTIC_ELECTRON_SKIP_APP_MODE_SMOKE: "1" } },
        description: "Skips the minimal app-mode smoke gate and attempts the full Plastic Electron launch path."
      }),
      auditAction({
        id: "extend-electron-app-mode-smoke-timeout",
        title: "Extend Electron app-mode smoke timeout",
        command: "PLASTIC_ELECTRON_APP_MODE_SMOKE_TIMEOUT_MS=10000 pnpm plastic:validate-electron",
        run: { command: "pnpm", args: ["plastic:validate-electron"], env: { PLASTIC_ELECTRON_APP_MODE_SMOKE_TIMEOUT_MS: "10000" } },
        description: "Gives the minimal Electron app-mode smoke check more time before classifying app mode as unavailable."
      })
    ];
  }
  if (diagnosisResult.code === "electron-child-running-compiled-main-not-entered") {
    return [
      auditAction({
        id: "try-electron-package-launch-mode",
        title: "Try Electron package launch mode",
        command: "PLASTIC_ELECTRON_LAUNCH_MODE=package PLASTIC_ELECTRON_SKIP_APP_MODE_SMOKE=1 pnpm plastic:validate-electron",
        run: { command: "pnpm", args: ["plastic:validate-electron"], env: { PLASTIC_ELECTRON_LAUNCH_MODE: "package", PLASTIC_ELECTRON_SKIP_APP_MODE_SMOKE: "1" } },
        description: "Compares package launch behavior against compiled-main launch behavior while preserving full Electron diagnostics."
      }),
      auditAction({
        id: "probe-electron-launch-targets",
        title: "Probe Electron launch targets",
        command: "PLASTIC_ELECTRON_LAUNCH_PROBE_RUN=1 node scripts/plastic-electron-launch-probe.mjs",
        run: { command: "node", args: ["scripts/plastic-electron-launch-probe.mjs"], env: { PLASTIC_ELECTRON_LAUNCH_PROBE_RUN: "1" } },
        description: "Compares direct, CLI-wrapper, and isolated-profile Electron launch targets, child command lines, and brief entry-marker probes without starting the full validation loop."
      })
    ];
  }
  return [
    auditAction({
      id: "rerun-runtime-unification-audit",
      title: "Rerun runtime unification audit",
      command: "pnpm plastic:audit-runtime-unification",
      run: { command: "pnpm", args: ["plastic:audit-runtime-unification"] },
      description: "Refreshes the persisted audit after the diagnosed issue is addressed."
    })
  ];
};

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
      nextAction: "Run pnpm plastic:audit-runtime-unification to create a runtime unification audit.",
      actions: diagnosticActionsFor(diagnosis("audit-missing", null, "No runtime unification audit has been written yet."))
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
  const diagnosisResult = diagnoseFailure(failurePhase, hints);
  const nextAction = diagnosisResult.code === "electron-app-mode-smoke-not-entered"
    ? "Electron app mode cannot enter a minimal app in this host. Fix host Electron app-mode launch or run PLASTIC_ELECTRON_SKIP_APP_MODE_SMOKE=1 pnpm plastic:validate-electron to force full Plastic launch diagnostics."
    : failurePhase === "electron"
    ? "Investigate Electron launch before Plastic main-process startup; compare host output, port listeners, and runtime startup logs."
    : failurePhase
      ? `Fix the ${failurePhase} validation failure, then rerun pnpm plastic:audit-runtime-unification.`
      : usable
        ? "Continue closing headed/headless runtime gaps; strict Electron is the remaining proof when degraded."
        : "Rerun pnpm plastic:audit-runtime-unification and inspect failed check diagnostics.";

  return { status, usable, strictElectron, unified, failurePhase, diagnosis: diagnosisResult, hints, nextAction, actions: diagnosticActionsFor(diagnosisResult) };
};

const auditActionInputSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: {
      type: "string",
      description: "Action id from runtime/auditStatus.verdict.actions."
    }
  }
};

const createAuditStatusReader = (plasticDir: string) => async () => {
  const path = join(plasticDir, "tmp", "runtime-unification-audit.json");
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
};

type ReadAuditStatus = ReturnType<typeof createAuditStatusReader>;

const registerAppDiagnostics = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  getDiagnostics: () => unknown;
}) =>
  input.runPromise(
    input.methods.register({
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

const registerAuditStatus = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  readAuditStatus: ReadAuditStatus;
}) =>
  input.runPromise(
    input.methods.register({
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
      handler: () => Effect.promise(input.readAuditStatus)
    })
  );

const registerRunAuditAction = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  appendEvent: AppendEvent;
  readAuditStatus: ReadAuditStatus;
  runCommand: (command: string, args: string[], env?: Record<string, string>) => Promise<RuntimeCommandResult>;
}) =>
  input.runPromise(
    input.methods.register({
      id: "runtime/runAuditAction",
      title: "Run audit action",
      description: "Runs a known diagnostic action from runtime/auditStatus.verdict.actions and records the result.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: runtimeDiagnosticsAvailability,
      inputSchema: auditActionInputSchema,
      examples: [
        {
          title: "Run a current audit action",
          input: { id: "extend-electron-app-mode-smoke-timeout" },
          expectedEvents: ["runtime.auditAction.completed"],
          verifyWith: { method: "runtime/auditStatus", input: {} }
        }
      ],
      effects: {
        durableEvents: ["runtime.auditAction.completed"],
        mutatesProjection: ["events"]
      },
      reversibility: {
        reversible: false,
        notes: "The diagnostic command result is appended to the event log; compensate by appending a later diagnostic event."
      },
      handler: (rawInput: unknown) =>
        Effect.promise(async () => {
          const actionId = (rawInput as { id?: unknown })?.id;
          if (typeof actionId !== "string") {
            throw new Error("runtime/runAuditAction requires string id");
          }
          const auditStatus = await input.readAuditStatus();
          const action = auditStatus.verdict.actions.find((candidate) => candidate.id === actionId);
          if (!action) {
            throw new Error(`No current runtime audit action found for id ${actionId}`);
          }
          const command = action.run;
          const startedAt = new Date().toISOString();
          const result = await input.runCommand(command.command, command.args, command.env);
          const completed = {
            ok: result.exitCode === 0,
            action,
            startedAt,
            completedAt: new Date().toISOString(),
            command: result.command,
            args: result.args,
            env: command.env ?? {},
            exitCode: result.exitCode,
            signal: result.signal,
            stdout: result.stdout.slice(-20000),
            stderr: result.stderr.slice(-20000)
          };
          const event = await input.appendEvent({
            type: "runtime.auditAction.completed",
            payload: completed
          });
          return { ...completed, eventId: event.id };
        })
    })
  );

export const createRuntimeDiagnosticsModule = (input: {
  getDiagnostics: () => unknown;
  plasticDir: string;
  runCommand: (command: string, args: string[], env?: Record<string, string>) => Promise<RuntimeCommandResult>;
}): RuntimeModule => ({
  id: "runtime-diagnostics",
  register: async ({ methods, runPromise, appendEvent }) => {
    const readAuditStatus = createAuditStatusReader(input.plasticDir);
    await registerAppDiagnostics({ methods, runPromise, getDiagnostics: input.getDiagnostics });
    await registerAuditStatus({ methods, runPromise, readAuditStatus });
    await registerRunAuditAction({ methods, runPromise, appendEvent, readAuditStatus, runCommand: input.runCommand });
  }
});
