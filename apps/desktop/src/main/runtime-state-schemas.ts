import { runtimeHostControlPlaneSchema } from "./runtime-host-control-plane-schema.js";

const plasticStateEventsSchema = {
  type: "object",
  required: ["count", "latest"],
  properties: {
    count: { type: "number" },
    latest: { type: ["string", "null"] }
  }
};

export const plasticProjectionPanelSchema = {
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

export const plasticProjectionWindowSchema = {
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

export const plasticStateResourceLinkSchema = {
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

export const plasticStateResourceSchema = {
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
    panels: { type: "array", items: plasticProjectionPanelSchema },
    windows: { type: "array", items: plasticProjectionWindowSchema },
    events: plasticStateEventsSchema,
    controlPlane: runtimeHostControlPlaneSchema,
    bus: { type: "object" }
  }
};
