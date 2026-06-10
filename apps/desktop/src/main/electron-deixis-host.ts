import type { BrowserWindow as ElectronBrowserWindow, Rectangle } from "electron";
import type { ScreenshotInput, VisibleRef, WindowVisibleRefs } from "./deixis-types.js";

type BrowserWindowHost = {
  getAllWindows: () => ElectronBrowserWindow[];
  getFocusedWindow: () => ElectronBrowserWindow | null;
};

export const createElectronDeixisHost = (browserWindow: BrowserWindowHost) => {
  const listVisibleRefs = async (): Promise<WindowVisibleRefs[]> => {
    const refs = [];
    for (const window of browserWindow.getAllWindows()) {
      const windowRefs = await window.webContents.executeJavaScript(`
        [...document.querySelectorAll("[data-plastic-ref]")].map((element) => ({
          ref: element.dataset.plasticRef,
          panel: element.dataset.plasticPanel,
          extension: element.dataset.plasticExtension,
          command: element.dataset.plasticCommand,
          tag: element.tagName.toLowerCase(),
          text: (element.innerText || element.textContent || "").slice(0, 240),
          bounds: (() => {
            const rect = element.getBoundingClientRect();
            return {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            };
          })()
        }))
      `) as VisibleRef[];
      refs.push({ windowId: window.id, refs: windowRefs });
    }
    return refs;
  };

  const findWindow = (windowId?: number) => {
    if (windowId !== undefined) {
      return browserWindow.getAllWindows().find((window) => window.id === windowId) ?? null;
    }
    return browserWindow.getFocusedWindow() ?? browserWindow.getAllWindows()[0] ?? null;
  };

  const captureWindow = async (input: ScreenshotInput = {}) => {
    const target = findWindow(input.windowId);
    if (!target) {
      throw new Error("No window available");
    }

    let rect: Rectangle | undefined;
    if (input.ref) {
      const measured = await target.webContents.executeJavaScript(`
        (async () => {
          const ref = ${JSON.stringify(input.ref)};
          const element = [...document.querySelectorAll("[data-plastic-ref]")]
            .find((candidate) => candidate.dataset.plasticRef === ref);
          if (!element) {
            return null;
          }
          ${scrollRefIntoViewScript(input.ref)}
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const rect = element.getBoundingClientRect();
          return {
            x: Math.max(0, Math.floor(rect.x)),
            y: Math.max(0, Math.floor(rect.y)),
            width: Math.max(1, Math.ceil(rect.width)),
            height: Math.max(1, Math.ceil(rect.height))
          };
        })()
      `) as Rectangle | null;
      if (!measured) {
        throw new Error(`No visible element for ref ${input.ref}`);
      }
      rect = measured;
    }

    const image = await target.webContents.capturePage(rect);
    const size = image.getSize();
    return {
      windowId: target.id,
      ref: input.ref ?? null,
      width: size.width,
      height: size.height,
      dataUrl: image.toDataURL()
    };
  };

  const resolveVisibleRef = async (ref: string) => {
    const visibleRefs = await listVisibleRefs();
    for (const windowRefs of visibleRefs) {
      const match = windowRefs.refs.find((candidate) => candidate.ref === ref);
      if (match) {
        return { windowId: windowRefs.windowId, ref: match };
      }
    }
    return null;
  };

  return {
    captureWindow,
    findWindow,
    listVisibleRefs,
    panelIdFromRef,
    resolveVisibleRef,
    scrollRefIntoViewScript,
    sourceHintsFor
  };
};

export const scrollRefIntoViewScript = (ref: string) => `
  (() => {
    const ref = ${JSON.stringify(ref)};
    const element = [...document.querySelectorAll("[data-plastic-ref]")]
      .find((candidate) => candidate.dataset.plasticRef === ref);
    if (!element) {
      return false;
    }
    const rail = document.querySelector(".rail");
    if (rail && rail.contains(element)) {
      const railRect = rail.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      rail.scrollLeft += rect.left - railRect.left - Math.max(0, (rail.clientWidth - rect.width) / 2);
      rail.scrollTop += rect.top - railRect.top - Math.max(0, (rail.clientHeight - rect.height) / 2);
    } else {
      element.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
    }
    return true;
  })()
`;

export const panelIdFromRef = (ref: string) => {
  if (ref.startsWith("message:")) {
    return ref.split(":")[1];
  }
  for (const prefix of ["panel:", "chat-compose:", "chat-shell:", "chat-status:", "chat-buttons:", "chat-log:"]) {
    if (ref.startsWith(prefix)) {
      return ref.slice(prefix.length);
    }
  }
  const messageMatch = ref.match(/^message-([^-]+-.+)-\d+$/);
  return messageMatch?.[1];
};

export const sourceHintsFor = (input: { ref?: string; panelId?: string; extensionId?: string; command?: string }) => {
  const hints = new Set<string>();
  if (input.ref?.startsWith("panel:") || input.panelId) {
    hints.add("apps/desktop/src/renderer/main.ts");
    hints.add("apps/desktop/src/renderer/styles.css");
    hints.add("packages/core/src/panels.ts");
  }
  if (input.ref?.startsWith("panel-button:") || input.command?.startsWith("chats/")) {
    hints.add("apps/desktop/src/main/main.ts");
    hints.add("apps/desktop/src/main/codex-adapter.ts");
    hints.add("apps/desktop/src/renderer/main.ts");
  }
  if (input.extensionId?.startsWith("workspace.")) {
    hints.add("apps/desktop/src/main/extension-loader.ts");
    hints.add(".plastic/extensions");
  }
  if (input.command?.startsWith("codex/")) {
    hints.add("apps/desktop/src/main/codex-adapter.ts");
    hints.add("docs/CODEX_APP_SERVER_INTEGRATION.md");
  }
  if (input.command?.startsWith("panels/")) {
    hints.add("packages/core/src/panels.ts");
    hints.add("apps/desktop/src/main/main.ts");
  }
  return [...hints];
};
