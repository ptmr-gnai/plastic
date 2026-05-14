import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const cwd = new URL("..", import.meta.url).pathname;
const viteUrl = "http://127.0.0.1:5173";
const electronMain = new URL("../dist-electron/main/main.js", import.meta.url).pathname;

const children = new Set();

const run = (command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
};

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

run("pnpm", ["exec", "tsc", "-p", "tsconfig.node.json", "--watch", "--preserveWatchOutput"]);
run("pnpm", ["exec", "vite", "--host", "127.0.0.1"]);

while (!existsSync(electronMain)) {
  await delay(250);
}

let viteReady = false;
while (!viteReady) {
  try {
    const response = await fetch(viteUrl);
    viteReady = response.ok;
  } catch {
    await delay(250);
  }
}

run("pnpm", ["exec", "electron", "."], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: viteUrl
  }
});

