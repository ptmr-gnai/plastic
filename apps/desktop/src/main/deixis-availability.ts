import { availabilityFromCapabilities, type CapabilityRegistry } from "./runtime-method-context.js";

export const deixisMethodCapabilities = {
  "deixis/listVisibleRefs": {
    required: ["dom.refs"],
    notes: "Requires a rendered DOM that exposes data-plastic-ref elements."
  },
  "windows/screenshot": {
    required: ["electron.window", "screenshot"],
    notes: "Requires a host that can capture Electron BrowserWindow pixels."
  },
  "deixis/resolveRef": {
    required: ["dom.refs"],
    notes: "Requires visible data-plastic-ref elements in a rendered DOM."
  },
  "deixis/evalDom": {
    required: ["dom.eval"],
    notes: "Requires a renderer DOM execution host."
  },
  "deixis/verifyRefAction": {
    required: ["dom.refs", "event.projection"],
    notes: "Requires visible refs plus the durable event projection."
  },
  "deixis/clickRef": {
    required: ["dom.refs", "dom.input"],
    notes: "Requires a rendered DOM and input control."
  },
  "deixis/fillRef": {
    required: ["dom.refs", "dom.input"],
    notes: "Requires a rendered DOM and input control."
  }
} satisfies Record<string, { required: Array<string>; notes: string }>;

export type DeixisMethodId = keyof typeof deixisMethodCapabilities;

export const deixisAvailability = (capabilities: CapabilityRegistry, methodId: DeixisMethodId) => {
  const contract = deixisMethodCapabilities[methodId];
  return availabilityFromCapabilities(capabilities, contract.required, contract.notes);
};
