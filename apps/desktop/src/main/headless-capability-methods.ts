import { Effect } from "effect";
import {
  projectPanels,
  projectWindows,
  type PlasticMethod
} from "@plastic/core";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";

const unavailable = (method: Omit<PlasticMethod, "owner" | "handler" | "availability"> & {
  requiredCapabilities: string[];
  notes: string;
}): PlasticMethod => {
  const plasticMethod: PlasticMethod = {
    id: method.id,
    title: method.title,
    owner: { kind: "runtime", id: "plastic.runtime" },
    availability: {
      status: "unavailable",
      requiredCapabilities: method.requiredCapabilities,
      missingCapabilities: method.requiredCapabilities,
      notes: method.notes
    },
    handler: () => Effect.promise(async () => {
      throw new Error(`${method.id} is unavailable in headless mode: ${method.notes}`);
    })
  };
  if (method.description !== undefined) {
    plasticMethod.description = method.description;
  }
  if (method.inputSchema !== undefined) {
    plasticMethod.inputSchema = method.inputSchema;
  }
  if (method.outputSchema !== undefined) {
    plasticMethod.outputSchema = method.outputSchema;
  }
  if (method.examples !== undefined) {
    plasticMethod.examples = method.examples;
  }
  if (method.effects !== undefined) {
    plasticMethod.effects = method.effects;
  }
  if (method.preconditions !== undefined) {
    plasticMethod.preconditions = method.preconditions;
  }
  if (method.reversibility !== undefined) {
    plasticMethod.reversibility = method.reversibility;
  }
  if (method.permissions !== undefined) {
    plasticMethod.permissions = method.permissions;
  }
  if (method.links !== undefined) {
    plasticMethod.links = method.links;
  }
  return plasticMethod;
};

const headlessUnavailableMethods: PlasticMethod[] = [
  unavailable({
    id: "windows/create",
    title: "Create window",
    description: "Creates an Electron window.",
    requiredCapabilities: ["electron.window"],
    notes: "Headless mode has no Electron BrowserWindow host."
  }),
  unavailable({
    id: "windows/focusPanel",
    title: "Focus panel",
    description: "Focuses a panel in an Electron window.",
    requiredCapabilities: ["electron.window", "dom.refs"],
    notes: "Headless mode has no focused window or DOM."
  }),
  unavailable({
    id: "windows/scrollToRef",
    title: "Scroll to visible UI reference",
    description: "Scrolls an Electron window to a visible data-plastic-ref.",
    requiredCapabilities: ["electron.window", "dom.refs"],
    notes: "Headless mode has no rendered DOM to scroll."
  }),
  unavailable({
    id: "windows/screenshot",
    title: "Capture window screenshot",
    description: "Captures a screenshot of an Electron window or visible ref.",
    requiredCapabilities: ["electron.window", "screenshot"],
    notes: "Headless mode has no screenshot provider."
  }),
  unavailable({
    id: "deixis/listVisibleRefs",
    title: "List visible UI references",
    description: "Lists visible data-plastic-ref elements in Electron windows.",
    requiredCapabilities: ["dom.refs"],
    notes: "Headless mode can inspect state/events but has no DOM projection."
  }),
  unavailable({
    id: "deixis/resolveRef",
    title: "Resolve visible UI reference",
    description: "Resolves a visible data-plastic-ref to panel, source, lineage, and actions.",
    requiredCapabilities: ["dom.refs"],
    notes: "Headless mode has no visible refs to resolve."
  }),
  unavailable({
    id: "deixis/evalDom",
    title: "Evaluate DOM script",
    description: "Evaluates JavaScript in the focused Electron renderer DOM.",
    requiredCapabilities: ["dom.eval"],
    notes: "Headless mode has no renderer DOM."
  }),
  unavailable({
    id: "deixis/clickRef",
    title: "Click visible UI reference",
    description: "Clicks a visible data-plastic-ref in Electron.",
    requiredCapabilities: ["dom.refs", "dom.input"],
    notes: "Headless mode has no rendered element to click."
  }),
  unavailable({
    id: "deixis/fillRef",
    title: "Fill visible UI reference",
    description: "Fills an input or textarea under a visible data-plastic-ref.",
    requiredCapabilities: ["dom.refs", "dom.input"],
    notes: "Headless mode has no rendered input to fill."
  }),
  unavailable({
    id: "deixis/verifyRefAction",
    title: "Verify ref action",
    description: "Verifies a recent ref-driven action through events and visible refs.",
    requiredCapabilities: ["dom.refs"],
    notes: "Headless mode can verify events directly, but cannot verify visible refs."
  })
];

export const headlessCapabilityModule: RuntimeModule = {
  id: "headless-capabilities",
  register: async (context: RuntimeMethodContext) => {
    const { eventStore, methods, runPromise } = context;

    await runPromise(
      methods.register({
        id: "windows/list",
        title: "List windows",
        description: "Returns the event-projected window model. In headless mode this is projection-only.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability: {
          status: "degraded",
          requiredCapabilities: ["window.projection"],
          missingCapabilities: ["electron.window"],
          notes: "Headless can project durable windows but cannot inspect live Electron windows."
        },
        handler: () =>
          Effect.map(eventStore.list(), (events) => projectWindows(events, projectPanels(events)))
      })
    );

    for (const method of headlessUnavailableMethods) {
      await runPromise(methods.register(method));
    }
  }
};
