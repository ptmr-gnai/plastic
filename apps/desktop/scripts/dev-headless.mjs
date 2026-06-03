import { spawn } from "node:child_process";
import { createReadStream, existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const cwd = new URL("..", import.meta.url).pathname;
const workspaceDir = new URL("../../..", import.meta.url).pathname;
const headlessMain = new URL("../dist-electron/main/headless.js", import.meta.url).pathname;
const tscBin = new URL("../node_modules/typescript/bin/tsc", import.meta.url).pathname;
const distDir = new URL("../dist", import.meta.url).pathname;
const staticPort = Number(process.env.PLASTIC_STATIC_PORT ?? 5173);
let staticServer;

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
  staticServer?.close();
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

run("node", [tscBin, "-p", "tsconfig.node.json", "--watch", "--preserveWatchOutput"]);

const mimeTypes = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".json", "application/json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

if (existsSync(new URL("../dist/index.html", import.meta.url))) {
  staticServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${staticPort}`);
    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(distDir, requestedPath));
    const relativePath = relative(distDir, filePath);
    if (!relativePath.startsWith("..")) {
      response.setHeader("content-type", mimeTypes.get(extname(filePath)) ?? "application/octet-stream");
      createReadStream(filePath)
        .on("error", () => {
          response.writeHead(404);
          response.end("Not found");
        })
        .pipe(response);
      return;
    }
    response.writeHead(403);
    response.end("Forbidden");
  });
  staticServer.listen(staticPort, "127.0.0.1", () => {
    console.log(`  ➜  Static: http://127.0.0.1:${staticPort}/`);
  });
} else {
  console.log("[plastic:headless] No renderer dist found. Run `pnpm --filter @plastic/desktop build` to refresh the browser UI.");
}

while (!existsSync(headlessMain)) {
  await delay(250);
}

run("node", [headlessMain], {
  env: {
    ...process.env,
    PLASTIC_WORKSPACE_DIR: workspaceDir
  }
});
