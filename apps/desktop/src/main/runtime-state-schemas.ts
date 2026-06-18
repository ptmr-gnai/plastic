import { runtimeHostControlPlaneSchema } from "./runtime-host-control-plane-schema.js";

export const plasticStateOutputSchema = {
  type: "object",
  required: ["app", "resources", "controlPlane"],
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
    events: { type: "object" },
    controlPlane: runtimeHostControlPlaneSchema,
    bus: { type: "object" }
  }
};
