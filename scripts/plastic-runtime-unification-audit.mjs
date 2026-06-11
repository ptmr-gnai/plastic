import { spawn } from "node:child_process";

const steps = [
  { id: "typecheck", command: "pnpm", args: ["typecheck"] },
  { id: "guardrails", command: "pnpm", args: ["guardrails"] },
  { id: "headless", command: "pnpm", args: ["plastic:validate-headless"] },
  {
    id: "electron",
    command: "pnpm",
    args: ["plastic:validate-electron"],
    env: { PLASTIC_ELECTRON_PREFLIGHT_TIMEOUT_MS: process.env.PLASTIC_ELECTRON_PREFLIGHT_TIMEOUT_MS ?? "3000" }
  },
  {
    id: "unified",
    command: "pnpm",
    args: ["plastic:validate-unified"],
    env: { PLASTIC_ELECTRON_PREFLIGHT_TIMEOUT_MS: process.env.PLASTIC_ELECTRON_PREFLIGHT_TIMEOUT_MS ?? "3000" }
  }
];

const runStep = (step) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    console.log(`[plastic:runtime-unification-audit] start ${step.id}`);
    const child = spawn(step.command, step.args, {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...(step.env ?? {}) }
    });
    child.on("exit", (code, signal) => {
      const result = {
        id: step.id,
        ok: code === 0,
        exit: code ?? signal ?? "unknown",
        ms: Date.now() - startedAt
      };
      console.log(`[plastic:runtime-unification-audit] ${result.ok ? "pass" : "fail"} ${step.id}`);
      resolve(result);
    });
  });

const results = [];
for (const step of steps) {
  const result = await runStep(step);
  results.push(result);
  if (!result.ok) {
    break;
  }
}

const summary = {
  ok: results.every((result) => result.ok) && results.length === steps.length,
  checks: results.length,
  expectedChecks: steps.length,
  results
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) {
  process.exitCode = 1;
}
