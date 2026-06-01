import type { PlasticEvent } from "./events.js";

export interface PlasticExtensionPanelContribution {
  id: string;
  title: string;
  kind?: string;
  rendererId?: string;
  subtitle?: string;
  body?: string;
  order?: number;
}

export interface PlasticExtensionRendererContribution {
  id: string;
  title?: string;
  panelKinds: string[];
  module?: string;
}

export interface PlasticExtensionMethodContribution {
  id: string;
  title?: string;
  description?: string;
}

export interface PlasticExtension {
  id: string;
  title: string;
  source: "bundled" | "workspace";
  path?: string;
  entry?: string;
  manifestPath?: string;
  panels: PlasticExtensionPanelContribution[];
  renderers: PlasticExtensionRendererContribution[];
  methods: PlasticExtensionMethodContribution[];
  errors: string[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const asPanelContributions = (value: unknown): PlasticExtensionPanelContribution[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .filter((item) => typeof item.id === "string" || typeof item.title === "string")
    .map((item, index) => {
      const panel: PlasticExtensionPanelContribution = {
        id: asString(item.id, `panel-${index}`),
        title: asString(item.title, asString(item.id, `Panel ${index + 1}`))
      };
      if (typeof item.kind === "string") {
        panel.kind = item.kind;
      }
      if (typeof item.rendererId === "string") {
        panel.rendererId = item.rendererId;
      }
      if (typeof item.subtitle === "string") {
        panel.subtitle = item.subtitle;
      }
      if (typeof item.body === "string") {
        panel.body = item.body;
      }
      if (typeof item.order === "number" && Number.isFinite(item.order)) {
        panel.order = item.order;
      }
      return panel;
    });
};

const asRendererContributions = (value: unknown): PlasticExtensionRendererContribution[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .filter((item) => typeof item.id === "string")
    .map((item) => ({
      id: asString(item.id, ""),
      ...(typeof item.title === "string" ? { title: item.title } : {}),
      ...(typeof item.module === "string" ? { module: item.module } : {}),
      panelKinds: asStringArray(item.panelKinds)
    }))
    .filter((item) => item.id.length > 0);
};

const asMethodContributions = (value: unknown): PlasticExtensionMethodContribution[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return { id: item };
      }
      const record = asRecord(item);
      if (typeof record.id !== "string") {
        return null;
      }
      const method: PlasticExtensionMethodContribution = { id: record.id };
      if (typeof record.title === "string") {
        method.title = record.title;
      }
      if (typeof record.description === "string") {
        method.description = record.description;
      }
      return method;
    })
    .filter((item): item is PlasticExtensionMethodContribution => item !== null);
};

export const extensionFromManifest = (input: {
  path?: string;
  entry?: string;
  manifestPath?: string;
  manifest: unknown;
  fallbackId: string;
  fallbackTitle?: string;
  source?: "bundled" | "workspace";
  errors?: string[];
}): PlasticExtension => {
  const manifest = asRecord(input.manifest);
  const extension: PlasticExtension = {
    id: asString(manifest.id, input.fallbackId),
    title: asString(manifest.title ?? manifest.name, input.fallbackTitle ?? input.fallbackId),
    source: input.source ?? "workspace",
    panels: asPanelContributions(manifest.panels),
    renderers: asRendererContributions(manifest.renderers),
    methods: asMethodContributions(manifest.methods),
    errors: input.errors ?? []
  };
  if (input.path) {
    extension.path = input.path;
  }
  if (input.entry) {
    extension.entry = input.entry;
  }
  if (input.manifestPath) {
    extension.manifestPath = input.manifestPath;
  }
  return extension;
};

export const projectExtensions = (events: PlasticEvent[]): PlasticExtension[] => {
  const extensions = new Map<string, PlasticExtension>();

  for (const event of events) {
    if (event.type === "extension.discovered") {
      const payload = asRecord(event.payload);
      const input: Parameters<typeof extensionFromManifest>[0] = {
        manifest: payload.manifest,
        fallbackId: asString(payload.id, event.scope.extensionId ?? event.id),
        source: payload.source === "bundled" ? "bundled" : "workspace",
        errors: asStringArray(payload.errors)
      };
      if (typeof payload.path === "string") {
        input.path = payload.path;
      }
      if (typeof payload.entry === "string") {
        input.entry = payload.entry;
      }
      if (typeof payload.manifestPath === "string") {
        input.manifestPath = payload.manifestPath;
      }
      if (typeof payload.title === "string") {
        input.fallbackTitle = payload.title;
      }
      const extension = extensionFromManifest(input);
      extensions.set(extension.id, extension);
    }

    if (event.type === "extension.removed") {
      const payload = asRecord(event.payload);
      const id = asString(payload.id, event.scope.extensionId ?? "");
      extensions.delete(id);
    }
  }

  return [...extensions.values()].sort((left, right) => left.id.localeCompare(right.id));
};
