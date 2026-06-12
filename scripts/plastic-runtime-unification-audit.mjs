import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const outPath = process.env.PLASTIC_RUNTIME_UNIFICATION_AUDIT_OUT ?? ".plastic/tmp/runtime-unification-audit.json";
const electronDiagnosticEnv = {
  PLASTIC_ELECTRON_PREFLIGHT_TIMEOUT_MS: process.env.PLASTIC_ELECTRON_PREFLIGHT_TIMEOUT_MS ?? "3000",
  PLASTIC_ELECTRON_APP_MODE_SMOKE_TIMEOUT_MS: process.env.PLASTIC_ELECTRON_APP_MODE_SMOKE_TIMEOUT_MS ?? "3000",
  ...(process.env.PLASTIC_ELECTRON_SKIP_APP_MODE_SMOKE === "1" ? { PLASTIC_ELECTRON_SKIP_APP_MODE_SMOKE: "1" } : {}),
  ...(process.env.PLASTIC_ELECTRON_LAUNCH_MODE ? { PLASTIC_ELECTRON_LAUNCH_MODE: process.env.PLASTIC_ELECTRON_LAUNCH_MODE } : {})
};

const steps = [
  { id: "typecheck", command: "pnpm", args: ["typecheck"] },
  { id: "guardrails", command: "pnpm", args: ["guardrails"] },
  { id: "headless", command: "pnpm", args: ["plastic:validate-headless"] },
  {
    id: "electron",
    command: "pnpm",
    args: ["plastic:validate-electron"],
    env: electronDiagnosticEnv,
    continueOnFailure: true
  },
  {
    id: "unified",
    command: "pnpm",
    args: ["plastic:validate-unified"],
    env: electronDiagnosticEnv
  }
];

const writeSummary = async (results) => {
  const byId = Object.fromEntries(results.map((result) => [result.id, result]));
  const failed = results.filter((result) => !result.ok);
  const blockingFailures = failed.filter((result) => result.id !== "electron").map((result) => result.id);
  const strictElectron = byId.electron?.ok ? "passed" : byId.electron ? "failed" : "not-run";
  const unified = byId.unified?.ok ? strictElectron === "passed" ? "passed" : "degraded" : byId.unified ? "failed" : "not-run";
  const firstFailure = failed[0] ?? null;
  const summary = {
    ok: results.every((result) => result.ok) && results.length === steps.length,
    checks: results.length,
    expectedChecks: steps.length,
    continuedAfterFailure: failed.length > 0,
    failures: {
      count: failed.length,
      ids: failed.map((result) => result.id),
      blockingIds: blockingFailures,
      first: firstFailure
        ? {
          id: firstFailure.id,
          exit: firstFailure.exit,
          command: firstFailure.command,
          env: firstFailure.env ?? {},
          hints: firstFailure.diagnostics?.hints ?? [],
          tail: firstFailure.diagnostics?.tail ?? []
        }
        : null
    },
    diagnosticEnvironment: {
      electron: electronDiagnosticEnv
    },
    runtimeUnification: {
      usable: blockingFailures.length === 0 && byId.headless?.ok === true && byId.unified?.ok === true,
      strictElectron,
      unified,
      blockingFailures
    },
    results
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
};

const runStep = (step) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const output = [];
    const pushOutput = (stream, chunk) => {
      const text = chunk.toString();
      stream.write(text);
      output.push(...text.split(/\r?\n/).filter(Boolean).map((line) => line.slice(0, 500)));
      if (output.length > 160) {
        output.splice(0, output.length - 160);
      }
    };
    console.log(`[plastic:runtime-unification-audit] start ${step.id}`);
    const child = spawn(step.command, step.args, {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env, ...(step.env ?? {}) }
    });
    child.stdout?.on("data", (chunk) => pushOutput(process.stdout, chunk));
    child.stderr?.on("data", (chunk) => pushOutput(process.stderr, chunk));
    child.on("exit", (code, signal) => {
      const result = {
        id: step.id,
        ok: code === 0,
        exit: code ?? signal ?? "unknown",
        ms: Date.now() - startedAt,
        command: [step.command, ...step.args].join(" ")
      };
      if (step.env) {
        result.env = step.env;
      }
      if (!result.ok) {
        result.diagnostics = {
          tail: output,
          hints: output
            .filter((line) => /plastic:entry|entry-cjs|entry-preflight|electron app-mode smoke|electronAppModeSmokeHint|plastic:electron-smoke|electronStartupHint|electron-main-ready|electron-launch|electron-child-status|electron-child-lsof|vite-ready|did not become ready|lsof -nP -iTCP:7331|lsof -nP -iTCP:7332|activeHostPid|activeHostExit/.test(line))
            .slice(-20)
        };
      }
      console.log(`[plastic:runtime-unification-audit] ${result.ok ? "pass" : "fail"} ${step.id}`);
      resolve(result);
    });
  });

const results = [];
await writeSummary(results);
for (const step of steps) {
  const result = await runStep(step);
  results.push(result);
  if (!result.ok && !step.continueOnFailure) {
    break;
  }
}

const summary = await writeSummary(results);
console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) {
  process.exitCode = 1;
}
