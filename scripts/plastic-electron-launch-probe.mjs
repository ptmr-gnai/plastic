import { existsSync, readFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const probeTimeoutMs = Number(process.env.PLASTIC_ELECTRON_LAUNCH_PROBE_TIMEOUT_MS ?? "3000");

const rootDir = new URL("..", import.meta.url).pathname;
const desktopDir = resolve(rootDir, "apps/desktop");
const desktopRequire = createRequire(`${desktopDir}/package.json`);
const desktopPackage = JSON.parse(readFileSync(resolve(desktopDir, "package.json"), "utf8"));
const electronExecutable = desktopRequire("electron");
const compiledMain = resolve(desktopDir, "dist-electron/main/main.js");
const packageMain = resolve(desktopDir, desktopPackage.main ?? "");
const relevantEnv = Object.fromEntries(
  Object.entries(process.env)
    .filter(([key]) => key.startsWith("ELECTRON_") || key.startsWith("PLASTIC_ELECTRON_") || key === "VITE_DEV_SERVER_URL")
    .sort(([left], [right]) => left.localeCompare(right))
);

const readChildCommand = (pid) =>
  new Promise((resolveCommand) => {
    if (!pid) {
      resolveCommand(null);
      return;
    }
    execFile("ps", ["-o", "pid=,ppid=,state=,command=", "-p", String(pid)], (error, stdout, stderr) => {
      resolveCommand({
        ok: !error,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });

const probeLaunch = (label, command, args) =>
  new Promise((resolveProbe) => {
    let stdout = "";
    let stderr = "";
    let childCommand = null;
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: desktopDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? "1",
        VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173"
      }
    });
    setTimeout(async () => {
      childCommand = await readChildCommand(child.pid);
    }, Math.min(500, probeTimeoutMs));
    const timeout = setTimeout(() => {
      child.kill();
    }, probeTimeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolveProbe({ label, ok: false, error: error instanceof Error ? error.message : String(error), stdout, stderr, ms: Date.now() - startedAt });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      const combined = `${stdout}\n${stderr}`;
      resolveProbe({
        label,
        ok: combined.includes("[plastic:entry]") || combined.includes("[plastic:entry-cjs]"),
        pid: child.pid,
        exitCode: code,
        signal,
        sawEntry: combined.includes("[plastic:entry]"),
        sawPackageEntry: combined.includes("[plastic:entry-cjs]"),
        command: childCommand,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
        ms: Date.now() - startedAt
      });
    });
  });

const launchProbes = process.env.PLASTIC_ELECTRON_LAUNCH_PROBE_RUN === "1"
  ? {
      timeoutMs: probeTimeoutMs,
      directCompiledMain: await probeLaunch("directCompiledMain", electronExecutable, [compiledMain]),
      directPackage: await probeLaunch("directPackage", electronExecutable, [desktopDir]),
      cliCompiledMain: await probeLaunch("cliCompiledMain", "pnpm", ["exec", "electron", compiledMain]),
      cliPackage: await probeLaunch("cliPackage", "pnpm", ["exec", "electron", desktopDir])
    }
  : null;

console.log(JSON.stringify({
  ok: true,
  electronExecutable,
  desktopDir,
  launchModes: {
    compiledMain: {
      target: compiledMain,
      exists: existsSync(compiledMain)
    },
    package: {
      target: desktopDir,
      packageMain: desktopPackage.main ?? null,
      packageMainPath: packageMain,
      packageMainExists: existsSync(packageMain)
    }
  },
  launchProbes,
  relevantEnv
}, null, 2));
