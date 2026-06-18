import { buildStatusOutputSchema } from "./runtime-build-schemas.js";
import { codexStatusOutputSchema } from "./codex-backend-method-metadata.js";
import { visibleRefWindowSchema } from "./deixis-method-metadata.js";
import { plasticExtensionSchema } from "./extension-query-methods.js";
import { plasticEventSchema, plasticMethodSchema } from "./runtime-control-schemas.js";
import { runtimeHostControlPlaneSchema } from "./runtime-host-control-plane-schema.js";
import { plasticStateResourceLinkSchema, plasticStateResourceSchema } from "./runtime-state-schemas.js";

const plasticSnapshotPanelSchema = {
  type: "object",
  required: ["id", "title", "kind", "extensionId", "order"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    kind: { type: "string" },
    extensionId: { type: "string" },
    rendererId: { type: "string" },
    subtitle: { type: "string" },
    body: { type: "string" },
    windowId: { type: "string" },
    order: { type: "number" }
  }
};

const plasticSnapshotWindowSchema = {
  type: "object",
  required: ["id", "title", "panelIds", "open"],
  properties: {
    id: { type: "string" },
    electronWindowId: { type: "number" },
    title: { type: "string" },
    panelIds: { type: "array", items: { type: "string" } },
    open: { type: "boolean" }
  }
};

const plasticSnapshotRuntimeSchema = {
  type: "object",
  required: ["windowCount"],
  properties: {
    windowCount: { type: "number" },
    retainedWindowCount: { type: "number" },
    eventStream: { type: "string" }
  }
};

export const plasticSnapshotOutputSchema = {
  type: "object",
  required: [
    "app",
    "build",
    "runtime",
    "codex",
    "controlPlane",
    "methods",
    "panels",
    "resources",
    "windows",
    "extensions",
    "visibleRefs",
    "events",
    "links"
  ],
  properties: {
    app: {
      type: "object",
      required: ["name", "mode", "hostBase", "workspaceDir", "eventPath"],
      properties: {
        name: { type: "string" },
        mode: { type: "string", enum: ["electron", "headless"] },
        workspaceDir: { type: "string" },
        eventPath: { type: "string" },
        version: { type: "string" },
        ready: { type: "boolean" },
        hostBase: {
          type: "object",
          required: ["id", "version"],
          properties: {
            id: { type: "string", enum: ["runtime-host-base"] },
            version: { type: "number" }
          }
        }
      }
    },
    build: buildStatusOutputSchema,
    runtime: plasticSnapshotRuntimeSchema,
    codex: codexStatusOutputSchema,
    controlPlane: runtimeHostControlPlaneSchema,
    methods: {
      type: "object",
      required: ["count", "items"],
      properties: {
        count: { type: "number" },
        items: { type: "array", items: plasticMethodSchema }
      }
    },
    panels: { type: "array", items: plasticSnapshotPanelSchema },
    resources: { type: "array", items: plasticStateResourceSchema },
    windows: { type: "array", items: plasticSnapshotWindowSchema },
    extensions: { type: "array", items: plasticExtensionSchema },
    visibleRefs: { type: "array", items: visibleRefWindowSchema },
    events: {
      type: "object",
      required: ["count", "latest", "recent"],
      properties: {
        count: { type: "number" },
        latest: { anyOf: [plasticEventSchema, { type: "null" }] },
        recent: { type: "array", items: plasticEventSchema }
      }
    },
    links: { type: "array", items: plasticStateResourceLinkSchema }
  }
};
