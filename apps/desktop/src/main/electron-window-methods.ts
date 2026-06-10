import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import { Effect } from "effect";
import { projectWindows } from "@plastic/core";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";

type ElectronWindowHost = {
  getAllWindows: () => ElectronBrowserWindow[];
};

export const createElectronWindowModule = (input: {
  browserWindow: ElectronWindowHost;
  createWindow: (title?: string) => Promise<unknown>;
  scrollRefIntoViewScript: (ref: string) => string;
}): RuntimeModule => ({
  id: "electron-window",
  register: async (context) => {
    await registerWindowList(context);
    await registerWindowCreate(context, input.createWindow);
    await registerWindowFocusPanel(context, input.browserWindow, input.scrollRefIntoViewScript);
    await registerWindowScrollToRef(context, input.browserWindow, input.scrollRefIntoViewScript);
  }
});

const registerWindowList = async (context: RuntimeMethodContext) => {
  const { eventStore, methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "windows/list",
      title: "List windows",
      description: "Returns known windows rebuilt from durable events.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: {
        status: "available",
        requiredCapabilities: ["electron.window", "window.projection"]
      },
      handler: () => Effect.map(eventStore.list(), (events) => projectWindows(events))
    })
  );
};

const registerWindowCreate = async (
  context: RuntimeMethodContext,
  createWindow: (title?: string) => Promise<unknown>
) => {
  const { methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "windows/create",
      title: "Create window",
      description: "Opens a new Electron window and appends window.created.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: {
        status: "available",
        requiredCapabilities: ["electron.window"]
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const windowInput = methodInput as { title?: string };
          return createWindow(windowInput.title);
        })
    })
  );
};

const registerWindowFocusPanel = async (
  context: RuntimeMethodContext,
  browserWindow: ElectronWindowHost,
  scrollRefIntoViewScript: (ref: string) => string
) => {
  const { methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "windows/focusPanel",
      title: "Focus panel",
      description: "Scrolls a visible panel into view and focuses its window.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: {
        status: "available",
        requiredCapabilities: ["electron.window", "dom.refs"]
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const panelId = (methodInput as { panelId?: string }).panelId;
          if (!panelId) {
            throw new Error("windows/focusPanel requires panelId");
          }
          return scrollWindowsToRef(browserWindow, scrollRefIntoViewScript(`panel:${panelId}`));
        })
    })
  );
};

const registerWindowScrollToRef = async (
  context: RuntimeMethodContext,
  browserWindow: ElectronWindowHost,
  scrollRefIntoViewScript: (ref: string) => string
) => {
  const { methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "windows/scrollToRef",
      title: "Scroll to visible ref",
      description: "Scrolls any visible data-plastic-ref into view.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: {
        status: "available",
        requiredCapabilities: ["electron.window", "dom.refs"]
      },
      handler: (methodInput) =>
        Effect.promise(async () => {
          const ref = (methodInput as { ref?: string }).ref;
          if (!ref) {
            throw new Error("windows/scrollToRef requires ref");
          }
          return scrollWindowsToRef(browserWindow, scrollRefIntoViewScript(ref));
        })
    })
  );
};

const scrollWindowsToRef = async (
  browserWindow: ElectronWindowHost,
  script: string
) => {
  const result = [];
  for (const window of browserWindow.getAllWindows()) {
    const found = await window.webContents.executeJavaScript(script) as boolean;
    if (found) {
      window.focus();
    }
    result.push({ windowId: window.id, found });
  }
  return result;
};
