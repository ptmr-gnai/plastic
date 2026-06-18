import { plasticEventSchema, plasticMethodSchema } from "./runtime-control-schemas.js";
import { runtimeHostControlPlaneSchema } from "./runtime-host-control-plane-schema.js";

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
      required: ["name", "mode", "hostBase"],
      properties: {
        name: { type: "string" },
        mode: { type: "string", enum: ["electron", "headless"] },
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
    build: { type: "object" },
    runtime: { type: "object" },
    codex: { type: "object" },
    controlPlane: runtimeHostControlPlaneSchema,
    methods: {
      type: "object",
      required: ["count", "items"],
      properties: {
        count: { type: "number" },
        items: { type: "array", items: plasticMethodSchema }
      }
    },
    panels: { type: "array", items: { type: "object" } },
    resources: { type: "array", items: { type: "object" } },
    windows: { type: "array", items: { type: "object" } },
    extensions: { type: "array", items: { type: "object" } },
    visibleRefs: { type: "array", items: { type: "object" } },
    events: {
      type: "object",
      required: ["count", "latest", "recent"],
      properties: {
        count: { type: "number" },
        latest: { anyOf: [plasticEventSchema, { type: "null" }] },
        recent: { type: "array", items: plasticEventSchema }
      }
    },
    links: { type: "array", items: { type: "object" } }
  }
};
