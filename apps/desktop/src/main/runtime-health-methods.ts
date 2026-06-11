import { Effect } from "effect";
import {
  projectExtensions,
  projectPanels,
  projectWindows
} from "@plastic/core";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";

type HealthCheck = {
  id: string;
  ok: boolean;
  details?: unknown;
};

type HostHealthCheck = {
  id: string;
  run: () => Promise<unknown> | unknown;
};

const runtimeHealthAvailability = {
  status: "available" as const,
  notes: "Self-test is a shared runtime health primitive in headed and headless modes."
};

export const createRuntimeHealthModule = (input: {
  description?: string;
  hostChecks?: HostHealthCheck[];
} = {}): RuntimeModule => ({
  id: "runtime-health",
  register: async ({ eventStore, methods, appendEvent, runPromise }: RuntimeMethodContext) => {
    await runPromise(
      methods.register({
        id: "plastic/selfTest",
        title: "Plastic self-test",
        description: input.description ?? "Runs a fast control-plane health check for event store, projections, methods, and host capabilities.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: runtimeHealthAvailability,
        handler: () =>
          Effect.promise(async () => {
            const checks: HealthCheck[] = [];
            const record = (id: string, fn: () => Promise<unknown> | unknown) =>
              Promise.resolve()
                .then(fn)
                .then((details) => checks.push({ id, ok: true, details }))
                .catch((error) => checks.push({ id, ok: false, details: error instanceof Error ? error.message : String(error) }));

            const events = await runPromise(eventStore.list());
            const methodList = await runPromise(methods.list());
            await record("event-store:list", () => ({ count: events.length }));
            await record("methods:list", () => {
              const missingAvailability = methodList
                .filter((method) => !method.availability?.status)
                .map((method) => method.id);
              if (missingAvailability.length > 0) {
                throw new Error(`Methods missing availability: ${missingAvailability.join(", ")}`);
              }
              return { count: methodList.length, missingAvailability };
            });
            await record("panels:project", () => ({ count: projectPanels(events).length }));
            await record("windows:project", () => ({ count: projectWindows(events).length }));
            await record("extensions:project", () => ({ count: projectExtensions(events).length }));
            for (const check of input.hostChecks ?? []) {
              await record(check.id, check.run);
            }

            const ok = checks.every((check) => check.ok);
            const event = await appendEvent({
              type: "plastic.self_test.completed",
              payload: { ok, checks }
            });
            return { ok, checks, eventId: event.id };
          })
      })
    );
  }
});
