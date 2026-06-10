import { spawn } from "node:child_process";
import type { RuntimeCommandResult } from "./runtime-build-methods.js";

export type GitStatusResult = {
  ok: boolean;
  exitCode: number | null;
  files: Array<{
    status: string;
    path: string;
  }>;
  stderr: string;
};

export const createWorkspaceCommandRunner = (workspaceDir: string) =>
  (command: string, args: string[]): Promise<RuntimeCommandResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: workspaceDir,
        env: process.env
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("exit", (exitCode, signal) => {
        resolve({ command, args, exitCode, signal, stdout, stderr });
      });
    });

export const createGitStatusReader = (input: {
  runCommand: (command: string, args: string[]) => Promise<RuntimeCommandResult>;
}) => async (): Promise<GitStatusResult> => {
  try {
    const status = await input.runCommand("git", ["status", "--short"]);
    return {
      ok: status.exitCode === 0,
      exitCode: status.exitCode,
      files: status.stdout
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => ({
          status: line.slice(0, 2),
          path: line.slice(3)
        })),
      stderr: status.stderr
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      files: [],
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
};
