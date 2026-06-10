import type { RuntimeCapability } from "./runtime-method-context.js";

const sharedCapabilities = (): RuntimeCapability[] => [
  { id: "runtime.capabilities", title: "Runtime capability registry", status: "available" },
  { id: "window.projection", title: "Window projection", status: "available" },
  { id: "event.projection", title: "Event projection", status: "available" }
];

export const createHeadlessRuntimeCapabilities = (): RuntimeCapability[] => [
  ...sharedCapabilities(),
  { id: "electron.window", title: "Electron windows", status: "unavailable", notes: "Headless mode has no Electron BrowserWindow host." },
  { id: "dom.refs", title: "DOM visible refs", status: "unavailable", notes: "Headless mode has no rendered DOM projection." },
  { id: "dom.eval", title: "DOM evaluation", status: "unavailable", notes: "Headless mode has no renderer DOM." },
  { id: "dom.input", title: "DOM input control", status: "unavailable", notes: "Headless mode has no rendered input elements." },
  { id: "screenshot", title: "Window screenshot capture", status: "unavailable", notes: "Headless mode has no screenshot provider." },
  { id: "agent.codex", title: "Codex agent backend", status: "unavailable", notes: "Headless mode has no Codex app-server adapter attached yet." }
];

export const createElectronRuntimeCapabilities = (): RuntimeCapability[] => [
  ...sharedCapabilities(),
  { id: "electron.window", title: "Electron windows", status: "available" },
  { id: "dom.refs", title: "DOM visible refs", status: "available" },
  { id: "dom.eval", title: "DOM evaluation", status: "available" },
  { id: "dom.input", title: "DOM input control", status: "available" },
  { id: "screenshot", title: "Window screenshot capture", status: "available" },
  { id: "agent.codex", title: "Codex agent backend", status: "available" }
];
