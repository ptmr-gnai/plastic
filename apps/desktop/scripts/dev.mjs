import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const cwd = new URL("..", import.meta.url).pathname;
const workspaceDir = new URL("../../..", import.meta.url).pathname;
const viteUrl = "http://127.0.0.1:5173";
const electronMain = new URL("../dist-electron/main/main.js", import.meta.url).pathname;
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

console.log(`[plastic:dev] electron-launch cwd=${cwd} packageMain=main.cjs compiledMain=${electronMain}`);
const electronChild = run(electronExecutable, ["."], {
  env: {
    ...process.env,
    PLASTIC_WORKSPACE_DIR: workspaceDir,
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "1",
    VITE_DEV_SERVER_URL: viteUrl
  }
});

electronChild.on("exit", (code, signal) => {
  if (process.env.PLASTIC_DEV_EXIT_ON_ELECTRON_EXIT === "1") {
    cleanup();
    process.exit(code ?? (signal ? 1 : 0));
  }
});
