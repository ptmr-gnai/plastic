import type { PlasticEvent } from "./events.js";

export interface PlasticPanel {
  id: string;
  title: string;
  kind: string;
  extensionId: string;
  rendererId?: string;
  subtitle?: string;
  body?: string;
  windowId?: string;
  order: number;
}

export interface PlasticWindow {
  id: string;
  electronWindowId?: number;
  title: string;
  panelIds: string[];
  open: boolean;
}

export interface PlasticPanelMessage {
  id: string;
  fromPanelId: string;
  toPanelId: string;
  type: string;
  content?: string;
  payload?: unknown;
  timestamp: string;
  status: "sent" | "read";
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const projectPanels = (events: PlasticEvent[]): PlasticPanel[] => {
  const panels = new Map<string, PlasticPanel>();

  for (const event of events) {
    const payload = asRecord(event.payload);

    if (event.type === "panel.created") {
      const id = asString(payload.id, event.scope.panelId ?? event.id);
      const panel: PlasticPanel = {
        id,
        title: asString(payload.title, id),
        kind: asString(payload.kind, "generic"),
        extensionId: asString(payload.extensionId, event.scope.extensionId ?? "plastic.user"),
        order: asNumber(payload.order) ?? panels.size
      };
      if (typeof payload.rendererId === "string") {
        panel.rendererId = payload.rendererId;
      }
      if (typeof payload.subtitle === "string") {
        panel.subtitle = payload.subtitle;
      }
      if (typeof payload.body === "string") {
        panel.body = payload.body;
      }
      const windowId = typeof payload.windowId === "string" ? payload.windowId : event.scope.windowId;
      if (windowId) {
        panel.windowId = windowId;
      }
      panels.set(id, panel);
    }

    if (event.type === "panel.renamed") {
      const id = asString(payload.id, event.scope.panelId ?? "");
      const panel = panels.get(id);
      if (panel) {
        const renamedPanel: PlasticPanel = {
          ...panel,
          title: asString(payload.title, panel.title)
        };
        if (typeof payload.subtitle === "string") {
          renamedPanel.subtitle = payload.subtitle;
        }
        panels.set(id, renamedPanel);
      }
    }

    if (event.type === "panel.moved") {
      const id = asString(payload.id, event.scope.panelId ?? "");
      const panel = panels.get(id);
      if (panel) {
        const movedPanel: PlasticPanel = {
          ...panel,
          order: asNumber(payload.order) ?? panel.order
        };
        if (typeof payload.windowId === "string") {
          movedPanel.windowId = payload.windowId;
        }
        panels.set(id, movedPanel);
      }
    }

    if (event.type === "panel.renderer.bound") {
      const id = asString(payload.id, event.scope.panelId ?? "");
      const panel = panels.get(id);
      if (panel && typeof payload.rendererId === "string") {
        panels.set(id, {
          ...panel,
          rendererId: payload.rendererId,
          extensionId: asString(payload.extensionId, panel.extensionId)
        });
      }
    }

    if (event.type === "panel.removed") {
      const id = asString(payload.id, event.scope.panelId ?? "");
      panels.delete(id);
    }
  }

  return [...panels.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
};

export const projectWindows = (events: PlasticEvent[], panels: PlasticPanel[] = projectPanels(events)): PlasticWindow[] => {
  const windows = new Map<string, PlasticWindow>();

  for (const event of events) {
    const payload = asRecord(event.payload);

    if (event.type === "window.created") {
      const electronWindowId = asNumber(payload.electronWindowId);
      const id = asString(payload.id, electronWindowId ? `electron:${electronWindowId}` : event.scope.windowId ?? event.id);
      const window: PlasticWindow = {
        id,
        title: asString(payload.title, "Plastic"),
        panelIds: [],
        open: true
      };
      if (electronWindowId !== undefined) {
        window.electronWindowId = electronWindowId;
      }
      windows.set(id, window);
    }

    if (event.type === "window.closed") {
      const electronWindowId = asNumber(payload.electronWindowId);
      const id = typeof payload.id === "string" ? payload.id : electronWindowId ? `electron:${electronWindowId}` : "";
      const window = windows.get(id);
      if (window) {
        windows.set(id, { ...window, open: false });
      }
    }
  }

  if (windows.size === 0) {
    windows.set("default", {
      id: "default",
      title: "Plastic",
      panelIds: [],
      open: true
    });
  }

  const orderedPanels = panels.filter((panel) => panel.windowId === undefined || windows.has(panel.windowId));
  for (const window of windows.values()) {
    window.panelIds = orderedPanels
      .filter((panel) => panel.windowId === undefined || panel.windowId === window.id)
      .map((panel) => panel.id);
  }

  return [...windows.values()];
};

export const projectPanelMessages = (events: PlasticEvent[]): PlasticPanelMessage[] => {
  const messages = new Map<string, PlasticPanelMessage>();

  for (const event of events) {
    const payload = asRecord(event.payload);

    if (event.type === "panel.message.sent") {
      const id = asString(payload.id, event.id);
      const message: PlasticPanelMessage = {
        id,
        fromPanelId: asString(payload.fromPanelId, ""),
        toPanelId: asString(payload.toPanelId, event.scope.panelId ?? ""),
        type: asString(payload.messageType, asString(payload.type, "text")),
        timestamp: event.timestamp,
        status: "sent"
      };
      if (typeof payload.content === "string") {
        message.content = payload.content;
      }
      if ("payload" in payload) {
        message.payload = payload.payload;
      }
      messages.set(id, message);
    }

    if (event.type === "panel.message.read") {
      const id = asString(payload.id, "");
      const message = messages.get(id);
      if (message) {
        messages.set(id, { ...message, status: "read" });
      }
    }
  }

  return [...messages.values()].filter((message) => message.fromPanelId && message.toPanelId);
};
