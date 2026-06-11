import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const runtimeUrl = process.env.PLASTIC_RUNTIME_URL ?? "http://127.0.0.1:7331";
const buildUrl = process.env.PLASTIC_BUILD_URL ?? "http://127.0.0.1:7332";
const rpcUrl = `${runtimeUrl}/rpc`;
const parityBaseline = process.env.PLASTIC_METHOD_PARITY_OUT ?? ".plastic/tmp/headless-methods.json";
const readinessTimeoutMs = Number(process.env.PLASTIC_VALIDATE_READY_TIMEOUT_MS ?? 90_000);
const electronPreflightTimeoutMs = Number(process.env.PLASTIC_ELECTRON_PREFLIGHT_TIMEOUT_MS ?? 10_000);
const validateScope = process.env.PLASTIC_VALIDATE_SCOPE ?? "all";
const desktopDir = new URL("../apps/desktop/", import.meta.url).pathname;
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));

if (!["all", "headless", "electron"].includes(validateScope)) {
  throw new Error(`Unknown PLASTIC_VALIDATE_SCOPE=${validateScope}. Expected all, headless, or electron.`);
}

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

const runWithTimeout = (command, args, timeoutMs, options = {}) =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const stdio = options.stdio ?? ["ignore", "pipe", "pipe"];
    const child = spawn(command, args, {
      cwd: new URL("..", import.meta.url).pathname,
      stdio,
      shell: process.platform === "win32",
      ...options
    });
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    const describeFailure = (reason) => {
      const details = [
        `${command} ${args.join(" ")} ${reason}`,
        `cwd: ${options.cwd ?? new URL("..", import.meta.url).pathname}`,
        `timeoutMs: ${timeoutMs}`,
        `stdout: ${stdout.trim() || "<empty>"}`,
        `stderr: ${stderr.trim() || "<empty>"}`
      ];
      return new Error(details.join("\n"));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(describeFailure(`did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ code, signal });
        return;
      }
      reject(describeFailure(`exited with ${code ?? signal}`));
    });
  });

const runCaptured = (command, args, options = {}) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      ...options
    });
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ command, args, code: null, signal: null, stdout, stderr: String(error) });
    });
    child.on("exit", (code, signal) => {
      resolve({ command, args, code, signal, stdout, stderr });
    });
  });

const runElectronPreflight = async () => {
  const electronExecutable = desktopRequire("electron");
  console.log(`[plastic:validate-hosts] electron preflight ${electronExecutable}`);
  await runWithTimeout(electronExecutable, ["-e", "console.log(process.versions.electron ?? 'unknown')"], electronPreflightTimeoutMs, {
    cwd: desktopDir,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "1",
      ELECTRON_RUN_AS_NODE: "1"
    }
  });
};

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

const capturedText = (result) => {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return [
    `$ ${result.command} ${result.args.join(" ")}`,
    `exit: ${result.code ?? result.signal ?? "unknown"}`,
    `stdout:\n${stdout || "<empty>"}`,
    `stderr:\n${stderr || "<empty>"}`
  ].join("\n");
};

const collectHostDiagnostics = async (label) => {
  if (process.platform === "win32") {
    return `No ${label} process diagnostics are configured for Windows yet.`;
  }
  const [processes, runtimePortState, buildPortState] = await Promise.all([
    runCaptured("ps", ["-axo", "pid,ppid,state,command"]),
    runCaptured("lsof", ["-nP", "-iTCP:7331", "-sTCP:LISTEN"]),
    runCaptured("lsof", ["-nP", "-iTCP:7332", "-sTCP:LISTEN"])
  ]);
  const processLines = processes.stdout
    .split("\n")
    .filter((line) => /plastic-validate-hosts|apps\/desktop\/scripts\/dev|dev-headless|tsc -p tsconfig\.node|vite --host|Electron|electron/.test(line))
    .join("\n");
  return [
    `[plastic:validate-hosts] ${label} diagnostics`,
    `activeHostPid: ${activeHost?.pid ?? "none"}`,
    `activeHostExit: ${activeHost?.exitCode ?? "running"}`,
    "matching processes:",
    processLines || "<none>",
    capturedText(runtimePortState),
    capturedText(buildPortState)
  ].join("\n");
};

const runHost = async ({ label, script, parity }) => {
  console.log(`[plastic:validate-hosts] starting ${label}`);
  startHost(script);
  try {
    try {
      await waitForHost(label);
    } catch (error) {
      const diagnostics = await collectHostDiagnostics(label);
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${diagnostics}`);
    }
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

if (validateScope === "all" || validateScope === "headless") {
  await runHost({ label: "headless", script: "dev-headless.mjs", parity: "capture" });
}

if (validateScope === "all" || validateScope === "electron") {
  await runElectronPreflight();
  await runHost({ label: "electron", script: "dev.mjs", parity: validateScope === "all" ? "compare" : "none" });
}

if (validateScope === "all") {
  console.log("[plastic:validate-hosts] headed/headless validation passed");
} else {
  console.log(`[plastic:validate-hosts] ${validateScope} validation passed`);
}
