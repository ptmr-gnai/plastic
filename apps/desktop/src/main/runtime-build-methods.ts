import { Effect } from "effect";
import { buildStatusOutputSchema } from "./runtime-build-schemas.js";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import type { RuntimeModule } from "./runtime-method-context.js";

export type RuntimeCommandResult = {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  stdout: string;
  stderr: string;
};

const runtimeCommandResultSchema = {
  type: "object",
  required: ["ok", "command", "args", "exitCode", "signal", "stdout", "stderr", "eventId"],
  properties: {
    ok: { type: "boolean" },
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    exitCode: { type: ["number", "null"] },
    signal: { type: ["string", "null"] },
    stdout: { type: "string" },
    stderr: { type: "string" },
    eventId: { type: "string" }
  }
};

const runtimeBuildAvailability = {
  status: "available" as const,
  notes: "Build methods are shared runtime primitives backed by the current host command runner."
};

export const createRuntimeBuildModule = (input: {
  getStatus: () => unknown;
  runCommand: (command: string, args: string[], env?: Record<string, string>) => Promise<RuntimeCommandResult>;
}): RuntimeModule => ({
  id: "runtime-build",
  register: async ({ methods, runPromise, appendEvent }) => {
    await runPromise(
      methods.register({
        id: "build/status",
        title: "Build status",
        description: "Returns the local build/dev socket status and key development environment paths.",
        owner: { kind: "runtime", id: "plastic.build" },
        availability: runtimeBuildAvailability,
        inputSchema: noInputSchema,
        outputSchema: buildStatusOutputSchema,
        examples: [
          {
            title: "Read build socket status",
            input: {},
            verifyWith: { method: "app/diagnostics", input: {} }
          }
        ],
        effects: readOnlyEffects,
        reversibility: readOnlyReversibility,
        handler: () => Effect.sync(input.getStatus)
      })
    );

    await runPromise(
      methods.register({
        id: "build/typecheck",
        title: "Run typecheck",
        description: "Runs pnpm typecheck, records stdout/stderr, and appends a durable build.typecheck.completed event.",
        owner: { kind: "runtime", id: "plastic.build" },
        availability: runtimeBuildAvailability,
        inputSchema: noInputSchema,
        outputSchema: runtimeCommandResultSchema,
        examples: [
          {
            title: "Run TypeScript validation",
            input: {},
            expectedEvents: ["build.typecheck.completed"],
            verifyWith: { method: "events/list", input: { types: ["build.typecheck.completed"], limit: 1 } }
          }
        ],
        effects: {
          durableEvents: ["build.typecheck.completed"],
          mutatesProjection: ["events"]
        },
        reversibility: {
          reversible: false,
          notes: "The typecheck result is appended to the event log; compensate by appending a later build event."
        },
        handler: () =>
          Effect.promise(async () => {
            const startedAt = new Date().toISOString();
            const result = await input.runCommand("pnpm", ["typecheck"]);
            const ok = result.exitCode === 0;
            const event = await appendEvent({
              type: "build.typecheck.completed",
              payload: {
                ok,
                startedAt,
                completedAt: new Date().toISOString(),
                command: result.command,
                args: result.args,
                exitCode: result.exitCode,
                signal: result.signal,
                stdout: result.stdout.slice(-20000),
                stderr: result.stderr.slice(-20000)
              }
            });
            return { ok, ...result, eventId: event.id };
          })
      })
    );
  }
});
