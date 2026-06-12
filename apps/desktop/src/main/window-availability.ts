import { availabilityFromCapabilities, type CapabilityRegistry } from "./runtime-method-context.js";

export const windowMethodCapabilities = {
  "windows/list": {
    required: ["electron.window", "window.projection"],
    degradedWhenMissing: ["electron.window"],
    notes: "This host can project durable windows but cannot inspect live Electron windows."
  },
  "windows/create": {
    required: ["electron.window"],
    degradedWhenMissing: [],
    notes: "Requires a host that can create Electron BrowserWindow instances."
  },
  "windows/focusPanel": {
    required: ["electron.window", "dom.refs"],
    degradedWhenMissing: [],
    notes: "Requires a rendered DOM and a focusable Electron window."
  },
  "windows/scrollToRef": {
    required: ["electron.window", "dom.refs"],
    degradedWhenMissing: [],
    notes: "Requires a rendered DOM and a focusable Electron window."
  },
  "renderer/reload": {
    required: ["electron.window"],
    degradedWhenMissing: [],
    notes: "Requires Electron renderer windows."
  }
} satisfies Record<string, { required: Array<string>; notes: string; degradedWhenMissing: Array<string> }>;

export type WindowMethodId = keyof typeof windowMethodCapabilities;

export const windowAvailability = (capabilities: CapabilityRegistry, methodId: WindowMethodId) => {
  const contract = windowMethodCapabilities[methodId];
  const degradedWhenMissing = contract.degradedWhenMissing ?? [];
  if (degradedWhenMissing.length > 0 && capabilities.missing(degradedWhenMissing).length > 0) {
    return {
      status: "degraded" as const,
      requiredCapabilities: contract.required,
      missingCapabilities: capabilities.missing(degradedWhenMissing),
      notes: contract.notes
    };
  }
  return availabilityFromCapabilities(capabilities, contract.required, contract.notes);
};
