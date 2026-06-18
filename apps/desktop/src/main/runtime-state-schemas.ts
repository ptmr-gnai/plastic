import { runtimeHostControlPlaneSchema } from "./runtime-host-control-plane-schema.js";

const plasticStateEventsSchema = {
  type: "object",
  required: ["count", "latest"],
  properties: {
    count: { type: "number" },
    latest: { type: ["string", "null"] }
  }
};

export const plasticStateOutputSchema = {
  type: "object",
  required: ["app", "events", "resources", "controlPlane"],
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
    resources: { type: "array", items: { type: "object" } },
    panels: { type: "array", items: { type: "object" } },
    windows: { type: "array", items: { type: "object" } },
    events: plasticStateEventsSchema,
    controlPlane: runtimeHostControlPlaneSchema,
    bus: { type: "object" }
  }
};
