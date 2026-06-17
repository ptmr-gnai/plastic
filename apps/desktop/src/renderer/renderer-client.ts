import type {
  ChatButton,
  PlasticPanel
} from "./panel-renderer-api.js";

export type PlasticState = {
  app: {
    name: "Plastic";
    theme: "light" | "dark";
  };
  controlPlane?: {
    runtime?: {
      port?: number;
    };
    build?: {
      port?: number;
    };
  };
  events: {
    count: number;
    latest: string | null;
  };
  resources: Array<{
    id: string;
    kind: string;
    title?: string;
    state: unknown;
    actions: Array<{ id: string; title: string; method: string }>;
  }>;
};

export type PlasticEvent = {
  type: string;
  payload: unknown;
};

type RuntimeHost = {
  controlPlane?: {
    runtime?: {
      eventStreamUrl?: string;
    };
  };
};

export type PlasticExtension = {
  id: string;
  title: string;
  path?: string;
  renderers: Array<{
    id: string;
    title?: string;
    module?: string;
    panelKinds: string[];
  }>;
};

export type CodexStatus = {
  connected: boolean;
  initialized: boolean;
  pid: number | null;
  pendingRequests: number;
};

export type PlasticSnapshot = {
  build: {
    status: string;
    viteUrl: string | null;
  };
  runtime: {
    windowCount: number;
    eventStreamClientCount: number;
  };
  codex: CodexStatus;
  methods: {
    count: number;
  };
  panels: PlasticPanel[];
  extensions: Array<{ id: string; title: string; errors: string[] }>;
  visibleRefs: Array<{ windowId: number; refs: Array<{ ref?: string; panel?: string; command?: string; text: string }> }>;
  events: {
    count: number;
    latest: { type: string; timestamp: string } | null;
  };
};

export const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export const callPlastic = async (method: string, input?: unknown): Promise<unknown> => {
  if (window.plastic) {
    return window.plastic.call(method, input);
  }

  const response = await fetch("http://127.0.0.1:7331/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, input })
  });
  const result = await response.json() as { ok: true; value: unknown } | { ok: false; error: string };
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
};

export const runtimeEventStreamUrl = async (): Promise<string> => {
  try {
    const host = await callPlastic("runtime/host") as RuntimeHost;
    if (host.controlPlane?.runtime?.eventStreamUrl) {
      return host.controlPlane.runtime.eventStreamUrl;
    }
  } catch {
    // Browser-only development can still fall back to the default local runtime.
  }
  return "http://127.0.0.1:7331/events/stream";
};

export const buttonFromEvent = (event: PlasticEvent): ChatButton | undefined =>
  (event.payload as { button?: ChatButton }).button;
