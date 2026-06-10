import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { CodexRpcMessage, PendingRequest } from "./codex-adapter.js";

type CodexSessionInput = {
  runtimeRpcUrl: string;
  runtimeRpcUrls: string[];
  pending: Map<number, PendingRequest>;
  appendCodexEvent: (type: string, payload: unknown) => Promise<{ id: string }>;
  handleMessage: (message: CodexRpcMessage) => void;
  configurePlasticMcp: () => Promise<unknown>;
};

const startCodexProcess = async (input: {
  codexPath: string;
  runtimeRpcUrl: string;
  runtimeRpcUrls: string[];
  pending: Map<number, PendingRequest>;
  appendCodexEvent: (type: string, payload: unknown) => Promise<{ id: string }>;
  handleMessage: (message: CodexRpcMessage) => void;
  onExit: () => void;
}) => {
  const processHandle = spawn(input.codexPath, ["app-server", "--listen", "stdio://"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PLASTIC_RPC_URL: input.runtimeRpcUrl,
      PLASTIC_RPC_URLS: input.runtimeRpcUrls.join(","),
      PLASTIC_RUNTIME_PORT: String(new URL(input.runtimeRpcUrl).port || 7331)
    }
  });
  const connectedAt = new Date().toISOString();

  const lines = createInterface({ input: processHandle.stdout });
  lines.on("line", (line) => {
    if (line.trim().length === 0) {
      return;
    }
    try {
      input.handleMessage(JSON.parse(line) as CodexRpcMessage);
    } catch (error) {
      void input.appendCodexEvent("codex.message.parse_failed", {
        line,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  processHandle.stderr.on("data", (chunk: Buffer) => {
    void input.appendCodexEvent("codex.stderr", {
      text: chunk.toString("utf8")
    });
  });

  processHandle.on("exit", (code, signal) => {
    void input.appendCodexEvent("codex.connection.exited", { code, signal });
    input.onExit();
    for (const requestState of input.pending.values()) {
      requestState.reject(new Error("Codex app-server exited"));
    }
    input.pending.clear();
  });

  await input.appendCodexEvent("codex.connection.started", {
    pid: processHandle.pid ?? null,
    codexPath: input.codexPath
  });

  return {
    connectedAt,
    processHandle
  };
};

export const createCodexAppServerSession = (input: CodexSessionInput) => {
  let processHandle: ChildProcessWithoutNullStreams | null = null;
  let nextId = 1;
  let initialized = false;
  let connectedAt: string | null = null;

  const send = (message: CodexRpcMessage) => {
    if (!processHandle) {
      throw new Error("Codex app-server is not connected");
    }
    processHandle.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const respondToServerRequest = (id: number, result: unknown) => {
    send({ id, result });
  };

  const rejectServerRequest = (id: number, error: unknown) => {
    send({
      id,
      error: error instanceof Error ? { message: error.message } : { message: String(error) }
    });
  };

  const request = async (method: string, params?: unknown): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    const sentEvent = await input.appendCodexEvent("codex.request.sent", {
      id,
      method,
      params
    });
    send({ id, method, params });
    return new Promise((resolve, reject) => {
      input.pending.set(id, {
        method,
        params,
        sentEventId: sentEvent.id,
        resolve,
        reject
      });
    });
  };

  const notify = (method: string, params?: unknown) => {
    void input.appendCodexEvent("codex.notification.sent", { method, params });
    send({ method, params });
  };

  const connect = async (codexPath = "codex") => {
    if (processHandle) {
      return {
        connected: true,
        initialized,
        pid: processHandle.pid ?? null,
        connectedAt
      };
    }

    const started = await startCodexProcess({
      codexPath,
      runtimeRpcUrl: input.runtimeRpcUrl,
      runtimeRpcUrls: input.runtimeRpcUrls,
      pending: input.pending,
      appendCodexEvent: input.appendCodexEvent,
      handleMessage: input.handleMessage,
      onExit: () => {
        processHandle = null;
        initialized = false;
      }
    });
    processHandle = started.processHandle;
    connectedAt = started.connectedAt;

    return {
      connected: true,
      initialized,
      pid: processHandle.pid ?? null,
      connectedAt
    };
  };

  const initialize = async () => {
    await connect();
    const result = await request("initialize", {
      clientInfo: {
        name: "plastic",
        title: "Plastic",
        version: "0.0.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    notify("initialized");
    initialized = true;
    await input.appendCodexEvent("codex.connection.initialized", { result });
    await input.configurePlasticMcp();
    return result;
  };

  const ensureInitialized = async () => {
    if (!processHandle) {
      await connect();
    }
    if (!initialized) {
      await initialize();
    }
  };

  const status = () => ({
    connected: Boolean(processHandle),
    initialized,
    pid: processHandle?.pid ?? null,
    connectedAt,
    pendingRequests: input.pending.size
  });

  return {
    connect,
    ensureInitialized,
    initialize,
    rejectServerRequest,
    request,
    respondToServerRequest,
    status
  };
};
