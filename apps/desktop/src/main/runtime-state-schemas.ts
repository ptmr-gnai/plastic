import { runtimeHostControlPlaneSchema } from "./runtime-host-control-plane-schema.js";

const plasticStateEventsSchema = {
  type: "object",
  required: ["count", "latest"],
  properties: {
    count: { type: "number" },
    latest: { type: ["string", "null"] }
  }
};

const plasticStateResourceLinkSchema = {
  type: "object",
  required: ["rel", "href"],
  properties: {
    rel: { type: "string" },
    href: { type: "string" },
    method: { type: "string" },
    target: { type: "string" },
    input: {},
    inputSchema: {}
  }
};

const plasticStateResourceActionSchema = {
  type: "object",
  required: ["id", "title", "method"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    method: { type: "string" },
    input: {},
    inputSchema: {},
    description: { type: "string" }
  }
};

const plasticStateResourceSchema = {
  type: "object",
  required: ["id", "kind", "state", "links", "actions"],
  properties: {
    id: { type: "string" },
    kind: { type: "string" },
    title: { type: "string" },
    state: {},
    links: { type: "array", items: plasticStateResourceLinkSchema },
    actions: { type: "array", items: plasticStateResourceActionSchema }
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
    resources: { type: "array", items: plasticStateResourceSchema },
    panels: { type: "array", items: { type: "object" } },
    windows: { type: "array", items: { type: "object" } },
    events: plasticStateEventsSchema,
    controlPlane: runtimeHostControlPlaneSchema,
    bus: { type: "object" }
  }
};
