import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const runtimeUrl = process.env.PLASTIC_RUNTIME_URL ?? "http://127.0.0.1:7331";
const buildUrl = process.env.PLASTIC_BUILD_URL ?? "http://127.0.0.1:7332";
const rpcUrl = `${runtimeUrl}/rpc`;
const parityBaseline = process.env.PLASTIC_METHOD_PARITY_OUT ?? ".plastic/tmp/headless-methods.json";
const readinessTimeoutMs = Number(process.env.PLASTIC_VALIDATE_READY_TIMEOUT_MS ?? 90_000);
const desktopDir = new URL("../apps/desktop/", import.meta.url).pathname;

let activeHost = null;

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve({ code, signal });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });

const startHost = (script) => {
  const child = spawn("node", [`scripts/${script}`], {
    cwd: desktopDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...(script === "dev.mjs" ? { PLASTIC_DEV_EXIT_ON_ELECTRON_EXIT: "1" } : {})
    }
  });
  activeHost = child;
  return child;
};

const stopHost = async () => {
  const child = activeHost;
  activeHost = null;
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGINT");
  await new Promise((resolve) => child.once("exit", resolve));
};

const waitForHealth = async (url, label) => {
  const deadline = Date.now() + readinessTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the host sockets are ready.
    }
    await delay(250);
  }
  throw new Error(`${label} did not become ready at ${url}`);
};

const waitForHost = async (label) => {
  await Promise.all([
    waitForHealth(`${runtimeUrl}/healthz`, `${label} runtime`),
    waitForHealth(`${buildUrl}/healthz`, `${label} build`)
  ]);
};

const runHost = async ({ label, script, parity }) => {
  console.log(`[plastic:validate-hosts] starting ${label}`);
  startHost(script);
  try {
    await waitForHost(label);
    console.log(`[plastic:validate-hosts] ${label} ready`);
    await run("pnpm", ["plastic:contract"], {
      env: { ...process.env, PLASTIC_RPC_URL: rpcUrl, PLASTIC_BUILD_URL: buildUrl }
    });
    if (parity === "capture") {
      await mkdir(dirname(parityBaseline), { recursive: true });
      await run("pnpm", ["plastic:method-parity"], {
        env: { ...process.env, PLASTIC_RPC_URL: rpcUrl, PLASTIC_METHOD_PARITY_OUT: parityBaseline }
      });
    }
    if (parity === "compare") {
      await run("pnpm", ["plastic:method-parity"], {
        env: { ...process.env, PLASTIC_RPC_URL: rpcUrl, PLASTIC_METHOD_PARITY_BASE: parityBaseline }
      });
    }
  } finally {
    await stopHost();
    console.log(`[plastic:validate-hosts] stopped ${label}`);
  }
};

process.on("SIGINT", () => {
  void stopHost().finally(() => process.exit(130));
});

process.on("SIGTERM", () => {
  void stopHost().finally(() => process.exit(143));
});

await runHost({ label: "headless", script: "dev-headless.mjs", parity: "capture" });
await runHost({ label: "electron", script: "dev.mjs", parity: "compare" });
console.log("[plastic:validate-hosts] headed/headless validation passed");
