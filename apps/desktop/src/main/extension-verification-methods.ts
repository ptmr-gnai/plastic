import { Effect } from "effect";
import {
  projectExtensions,
  type EventStore,
  type MethodRegistry
} from "@plastic/core";
import type { RunPromise } from "./runtime-method-context.js";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";
import { plasticEventSchema } from "./runtime-control-schemas.js";
import { appendVerificationEvent, latestVerificationStatus, verifyExtension } from "./extension-verifier.js";

const extensionVerificationAvailability = {
  status: "available" as const,
  notes: "Extension verification is a shared runtime primitive available in headed and headless modes."
};

const verificationCheckSchema = {
  type: "object",
  required: ["name", "ok", "message"],
  properties: {
    name: { type: "string" },
    ok: { type: "boolean" },
    message: { type: "string" }
  }
};

const verificationReportSchema = {
  type: "object",
  required: ["extensionId", "ok", "checks", "warnings", "errors"],
  properties: {
    extensionId: { type: "string" },
    ok: { type: "boolean" },
    checks: { type: "array", items: verificationCheckSchema },
    warnings: { type: "array", items: { type: "string" } },
    errors: { type: "array", items: { type: "string" } },
    panel: { type: "object" },
    event: plasticEventSchema
  }
};

const verificationStatusItemSchema = {
  type: "object",
  required: ["extensionId", "ok", "eventId", "eventType", "timestamp", "warningCount", "errorCount", "checkCount", "warnings", "errors"],
  properties: {
    extensionId: { type: "string" },
    ok: { type: "boolean" },
    eventId: { type: "string" },
    eventType: { type: "string", enum: ["extension.verified", "extension.verify_failed"] },
    timestamp: { type: "string" },
    panelId: { type: "string" },
    warningCount: { type: "number" },
    errorCount: { type: "number" },
    checkCount: { type: "number" },
    warnings: { type: "array" },
    errors: { type: "array" }
  }
};

const verificationStatusOutputSchema = {
  type: "object",
  required: ["items", "links"],
  properties: {
    items: { type: "array", items: verificationStatusItemSchema },
    links: { type: "array", items: { type: "object" } }
  }
};

const verifyAllOutputSchema = {
  type: "object",
  required: ["ok", "count", "failed", "reports"],
  properties: {
    ok: { type: "boolean" },
    count: { type: "number" },
    failed: { type: "array", items: { type: "string" } },
    reports: { type: "array", items: verificationReportSchema }
  }
};

export const registerExtensionVerificationMethods = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  await registerVerifyExtension(input);
  await registerVerifyAllExtensions(input);
  await registerVerificationStatus(input);
};

const registerVerifyExtension = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { workspaceDir, eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "extensions/verify",
      title: "Verify extension",
      description: "Checks whether an extension's declared files, panels, renderers, and optional target panel are usable, then writes a durable verification event.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: extensionVerificationAvailability,
      inputSchema: {
        type: "object",
        required: ["extensionId"],
        properties: {
          extensionId: { type: "string", description: "Extension id to verify." },
          panelId: { type: "string", description: "Optional panel id to verify against the extension." }
        }
      },
      outputSchema: verificationReportSchema,
      examples: [
        {
          title: "Verify one extension",
          input: { extensionId: "plastic.chat" },
          expectedEvents: ["extension.verified", "extension.verify_failed"],
          verifyWith: { method: "extensions/verificationStatus", input: {} }
        }
      ],
      effects: {
        durableEvents: ["extension.verified", "extension.verify_failed"],
        mutatesProjection: ["events"]
      },
      reversibility: {
        reversible: false,
        notes: "Verification results are appended to the event log; run verification again to supersede status."
      },
      handler: (inputValue) =>
        Effect.promise(async () => {
          const payload = inputValue as { extensionId?: string; panelId?: string };
          if (!payload.extensionId) {
            throw new Error("extensions/verify requires extensionId");
          }

          const extension = projectExtensions(await runPromise(eventStore.list())).find(
            (candidate) => candidate.id === payload.extensionId
          );
          if (!extension) {
            throw new Error(`Extension not found: ${payload.extensionId}`);
          }

          const report = await verifyExtension(workspaceDir, extension, payload.panelId);
          const event = await appendVerificationEvent({
            eventStore,
            runPromise,
            extension,
            report,
            ...(payload.panelId ? { panelId: payload.panelId } : {})
          });

          return {
            ...report,
            event
          };
        })
    })
  );
};

const registerVerifyAllExtensions = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { workspaceDir, eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "extensions/verifyAll",
      title: "Verify all extensions",
      description: "Checks every discovered extension and writes a durable verification event for each one.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: extensionVerificationAvailability,
      inputSchema: noInputSchema,
      outputSchema: verifyAllOutputSchema,
      examples: [
        {
          title: "Verify all extensions",
          input: {},
          expectedEvents: ["extension.verified", "extension.verify_failed"],
          verifyWith: { method: "extensions/verificationStatus", input: {} }
        }
      ],
      effects: {
        durableEvents: ["extension.verified", "extension.verify_failed"],
        mutatesProjection: ["events"]
      },
      reversibility: {
        reversible: false,
        notes: "Verification results are appended to the event log; run verification again to supersede status."
      },
      handler: () =>
        Effect.promise(async () => {
          const extensions = projectExtensions(await runPromise(eventStore.list()));
          const reports = [];

          for (const extension of extensions) {
            const report = await verifyExtension(workspaceDir, extension);
            const event = await appendVerificationEvent({ eventStore, runPromise, extension, report });
            reports.push({ ...report, event });
          }

          return {
            ok: reports.every((report) => report.ok),
            count: reports.length,
            failed: reports.filter((report) => !report.ok).map((report) => report.extensionId),
            reports
          };
        })
    })
  );
};

const registerVerificationStatus = async (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}) => {
  const { eventStore, methods, runPromise } = input;

  await runPromise(
    methods.register({
      id: "extensions/verificationStatus",
      title: "Extension verification status",
      description: "Returns the latest durable verification result for each extension.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: extensionVerificationAvailability,
      inputSchema: noInputSchema,
      outputSchema: verificationStatusOutputSchema,
      examples: [
        {
          title: "Read extension verification status",
          input: {},
          verifyWith: { method: "extensions/list", input: {} }
        }
      ],
      effects: readOnlyEffects,
      reversibility: readOnlyReversibility,
      handler: () =>
        Effect.map(eventStore.list(), (events) => ({
          items: latestVerificationStatus(events),
          links: [
            { rel: "verify", href: "extensions/verify", method: "extensions/verify" },
            { rel: "verify-all", href: "extensions/verifyAll", method: "extensions/verifyAll" },
            { rel: "extensions", href: "extensions/list", method: "extensions/list" }
          ]
        }))
    })
  );
};
