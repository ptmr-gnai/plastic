import { eventsTimelineOutputSchema, plasticEventSchema } from "./runtime-control-schemas.js";
import { noInputSchema, readOnlyEffects, readOnlyReversibility } from "./runtime-method-metadata.js";

const refInputSchema = {
  type: "object",
  required: ["ref"],
  properties: {
    windowId: { type: "number" },
    ref: { type: "string" },
    value: { type: "string" }
  }
};

const visibleRefSchema = {
  type: "object",
  required: ["tag", "text"],
  properties: {
    ref: { type: "string" },
    panel: { type: "string" },
    extension: { type: "string" },
    command: { type: "string" },
    tag: { type: "string" },
    text: { type: "string" },
    bounds: { type: "object" }
  }
};

export const visibleRefWindowSchema = {
  type: "object",
  required: ["windowId", "refs"],
  properties: {
    windowId: { type: "number" },
    refs: { type: "array", items: visibleRefSchema }
  }
};

const screenshotOutputSchema = {
  type: "object",
  required: ["windowId", "ref", "width", "height", "dataUrl"],
  properties: {
    windowId: { type: "number" },
    ref: { type: ["string", "null"] },
    width: { type: "number" },
    height: { type: "number" },
    dataUrl: { type: "string" }
  }
};

const refActionOutputSchema = {
  type: "object",
  required: ["windowId", "ref", "result", "eventId"],
  properties: {
    windowId: { type: "number" },
    ref: { type: "string" },
    result: {},
    eventId: { type: "string" }
  }
};

const refAffordanceSchema = {
  type: "object",
  required: ["id", "title", "method"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    method: { type: "string" },
    input: {}
  }
};

export const listVisibleRefsMetadata = {
  description: "Lists visible data-plastic-ref elements grouped by Electron window.",
  inputSchema: noInputSchema,
  outputSchema: { type: "array", items: visibleRefWindowSchema },
  examples: [{ title: "List visible refs", input: {}, verifyWith: { method: "runtime/capabilities", input: {} } }],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

export const screenshotMetadata = {
  inputSchema: { type: "object", properties: { windowId: { type: "number" }, ref: { type: "string" } } },
  outputSchema: screenshotOutputSchema,
  examples: [{ title: "Capture focused window", input: {}, verifyWith: { method: "runtime/capabilities", input: {} } }],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

export const resolveRefMetadata = {
  inputSchema: { type: "object", required: ["ref"], properties: { ref: { type: "string" } } },
  outputSchema: {
    type: "object",
    required: ["ref", "element", "ownership", "state", "sourceHints", "lineage", "verification", "actions"],
    properties: {
      ref: { type: "string" },
      element: { type: ["object", "null"] },
      visible: { type: ["object", "null"] },
      ownership: { type: "object" },
      state: { type: "object" },
      sourceHints: { type: "array", items: { type: "string" } },
      lineage: { type: "array", items: plasticEventSchema },
      verification: { type: "array", items: refAffordanceSchema },
      actions: { type: "array", items: refAffordanceSchema }
    }
  },
  examples: [{ title: "Resolve a panel ref", input: { ref: "panel:chat-main" }, verifyWith: { method: "deixis/listVisibleRefs", input: {} } }],
  effects: readOnlyEffects,
  reversibility: readOnlyReversibility
};

export const evalDomMetadata = {
  inputSchema: { type: "object", required: ["code"], properties: { code: { type: "string" } } },
  outputSchema: { description: "Arbitrary JSON-serializable result returned by the evaluated DOM script." },
  examples: [{ title: "Read document title", input: { code: "document.title" }, verifyWith: { method: "runtime/capabilities", input: {} } }],
  effects: { durableEvents: [], mutatesProjection: [] },
  reversibility: { reversible: false, notes: "DOM eval can mutate transient renderer state depending on the script." }
};

export const verifyRefActionMetadata = {
  inputSchema: { type: "object", required: ["ref"], properties: { ref: { type: "string" }, panelId: { type: "string" }, expectedEventType: { type: "string" }, expectedContent: { type: "string" }, after: { type: "string" }, limit: { type: "number" } } },
  outputSchema: {
    type: "object",
    required: ["ok", "ref", "matchedEvents", "refEvents", "verificationEventId"],
    properties: {
      ok: { type: "boolean" },
      ref: { type: "string" },
      panelId: { type: ["string", "null"] },
      matchedEvents: { type: "array", items: plasticEventSchema },
      refEvents: { type: "array", items: plasticEventSchema },
      timeline: eventsTimelineOutputSchema,
      verificationEventId: { type: "string" }
    }
  },
  examples: [{ title: "Verify a ref action", input: { ref: "panel:chat-main" }, expectedEvents: ["deixis.ref_action.verified"], verifyWith: { method: "events/timeline", input: {} } }],
  effects: { durableEvents: ["deixis.ref_action.verified"], mutatesProjection: ["events"] },
  reversibility: { reversible: false, notes: "Verification appends a durable observation event." }
};

export const clickRefMetadata = {
  inputSchema: refInputSchema,
  outputSchema: refActionOutputSchema,
  examples: [{ title: "Click a visible ref", input: { ref: "panel:chat-main" }, expectedEvents: ["deixis.ref.clicked"], verifyWith: { method: "deixis/verifyRefAction", input: { ref: "panel:chat-main" } } }],
  effects: { durableEvents: ["deixis.ref.clicked"], mutatesProjection: ["events"] },
  reversibility: { reversible: false, notes: "Clicking can trigger arbitrary UI behavior; inspect the target method metadata first." }
};

export const fillRefMetadata = {
  inputSchema: refInputSchema,
  outputSchema: refActionOutputSchema,
  examples: [{ title: "Fill a visible ref", input: { ref: "chat-compose:chat-main", value: "Hello" }, expectedEvents: ["deixis.ref.filled"], verifyWith: { method: "deixis/verifyRefAction", input: { ref: "chat-compose:chat-main" } } }],
  effects: { durableEvents: ["deixis.ref.filled"], mutatesProjection: ["events"] },
  reversibility: { reversible: false, notes: "Filling changes transient renderer state and records the action." }
};
