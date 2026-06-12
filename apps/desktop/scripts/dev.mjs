import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const cwd = new URL("..", import.meta.url).pathname;
const workspaceDir = new URL("../../..", import.meta.url).pathname;
const viteUrl = "http://127.0.0.1:5173";
const electronMain = new URL("../dist-electron/main/main.js", import.meta.url).pathname;
const electronAppPath = cwd;
const require = createRequire(import.meta.url);
const electronExecutable = require("electron");

const children = new Set();

const run = (command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });
  const label = [command, ...args].join(" ");
  console.log(`[plastic:dev] spawned ${label} pid=${child.pid ?? "unknown"}`);
  children.add(child);
  child.on("error", (error) => {
    console.log(`[plastic:dev] error ${label} ${error instanceof Error ? error.message : String(error)}`);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    console.log(`[plastic:dev] exited ${label} code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
  return child;
};

const runOnce = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options
    });
    const label = [command, ...args].join(" ");
    console.log(`[plastic:dev] preflight ${label} pid=${child.pid ?? "unknown"}`);
    child.on("exit", (code, signal) => {
      console.log(`[plastic:dev] preflight exited ${label} code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with ${code ?? signal ?? "unknown"}`));
    });
  });

const runCaptured = (command, args, options = {}) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd,
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
      resolve({ code: null, signal: null, stdout, stderr: String(error) });
    });
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });

const cleanup = () => {
  for (const child of children) {
    child.kill();
  }
};

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

rmSync(new URL("../dist-electron", import.meta.url), { force: true, recursive: true });

run("pnpm", ["exec", "tsc", "-p", "tsconfig.node.json", "--watch", "--preserveWatchOutput"]);
run("pnpm", ["exec", "vite", "--host", "127.0.0.1"]);

console.log(`[plastic:dev] waiting electron-main path=${electronMain}`);
while (!existsSync(electronMain)) {
  await delay(250);
}
console.log(`[plastic:dev] electron-main-ready path=${electronMain}`);
await runOnce(electronExecutable, [electronMain], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    PLASTIC_ELECTRON_ENTRY_PREFLIGHT: "1"
  }
});

let viteReady = false;
while (!viteReady) {
  try {
    const response = await fetch(viteUrl);
    viteReady = response.ok;
  } catch {
    await delay(250);
  }
}
console.log(`[plastic:dev] vite-ready url=${viteUrl}`);

console.log(`[plastic:dev] electron-launch cwd=${cwd} appPath=${electronAppPath} packageMain=main.cjs compiledMain=${electronMain}`);
const electronChild = run(electronExecutable, [electronAppPath], {
  env: {
    ...process.env,
    ELECTRON_ENABLE_STACK_DUMPING: process.env.ELECTRON_ENABLE_STACK_DUMPING ?? "1",
    PLASTIC_WORKSPACE_DIR: workspaceDir,
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "1",
    VITE_DEV_SERVER_URL: viteUrl
  }
});

setTimeout(() => {
  console.log(
    `[plastic:dev] electron-child-status pid=${electronChild.pid ?? "unknown"} exitCode=${electronChild.exitCode ?? "running"} signalCode=${electronChild.signalCode ?? "null"}`
  );
}, 2_500).unref();

setTimeout(() => {
  if (!electronChild.pid || electronChild.exitCode !== null) {
    return;
  }
  void runCaptured("lsof", ["-nP", "-p", String(electronChild.pid)]).then((result) => {
    const interesting = result.stdout
      .split("\n")
      .filter((line) => /Plastic|Electron Framework|main\.cjs|dist-electron|apps\/desktop/.test(line))
      .slice(0, 20);
    console.log(`[plastic:dev] electron-child-lsof pid=${electronChild.pid} exit=${result.code ?? result.signal ?? "unknown"}`);
    console.log(interesting.length > 0 ? interesting.join("\n") : "[plastic:dev] electron-child-lsof no matching app files");
  });
}, 3_000).unref();

electronChild.on("exit", (code, signal) => {
  if (process.env.PLASTIC_DEV_EXIT_ON_ELECTRON_EXIT === "1") {
    cleanup();
    process.exit(code ?? (signal ? 1 : 0));
  }
});
