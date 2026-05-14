import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import { createEvent, type EventStore, type MethodRegistry } from "@plastic/core";

interface CodexRpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface CodexAdapter {
  status: () => unknown;
  registerMethods: () => Promise<void>;
}

export const createCodexAdapter = (input: {
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;
}): CodexAdapter => {
  let processHandle: ChildProcessWithoutNullStreams | null = null;
  let nextId = 1;
  let initialized = false;
  let connectedAt: string | null = null;
  const pending = new Map<number, PendingRequest>();

  const appendCodexEvent = (type: string, payload: unknown) =>
    input.runPromise(
      input.eventStore.append(
        createEvent({
          type,
          payload,
          scope: { agentId: "codex" },
          actor: {
            kind: "agent",
            id: "codex",
            name: "Codex"
          }
        })
      )
    );

  const send = (message: CodexRpcMessage) => {
    if (!processHandle) {
      throw new Error("Codex app-server is not connected");
    }
    processHandle.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const request = (method: string, params?: unknown): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    send({ id, method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const notify = (method: string, params?: unknown) => {
    send({ method, params });
  };

  const handleMessage = (message: CodexRpcMessage) => {
    if (typeof message.id === "number" && pending.has(message.id)) {
      const requestState = pending.get(message.id);
      pending.delete(message.id);
      if (!requestState) {
        return;
      }
      if (message.error) {
        requestState.reject(new Error(JSON.stringify(message.error)));
      } else {
        requestState.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      void appendCodexEvent(`codex.${message.method.replaceAll("/", ".")}`, {
        method: message.method,
        params: message.params
      });
    }
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

    processHandle = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
      cwd: process.cwd(),
      env: process.env
    });
    connectedAt = new Date().toISOString();

    const lines = createInterface({ input: processHandle.stdout });
    lines.on("line", (line) => {
      if (line.trim().length === 0) {
        return;
      }
      try {
        handleMessage(JSON.parse(line) as CodexRpcMessage);
      } catch (error) {
        void appendCodexEvent("codex.message.parse_failed", {
          line,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    processHandle.stderr.on("data", (chunk: Buffer) => {
      void appendCodexEvent("codex.stderr", {
        text: chunk.toString("utf8")
      });
    });

    processHandle.on("exit", (code, signal) => {
      void appendCodexEvent("codex.connection.exited", { code, signal });
      processHandle = null;
      initialized = false;
      for (const requestState of pending.values()) {
        requestState.reject(new Error("Codex app-server exited"));
      }
      pending.clear();
    });

    await appendCodexEvent("codex.connection.started", {
      pid: processHandle.pid ?? null,
      codexPath
    });

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
    await appendCodexEvent("codex.connection.initialized", { result });
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
    pendingRequests: pending.size
  });

  const registerMethods = async () => {
    await input.runPromise(
      input.methods.register({
        id: "codex/status",
        title: "Codex status",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: () => Effect.sync(status)
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/connect",
        title: "Connect Codex app-server",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            const codexPath = (methodInput as { codexPath?: string } | undefined)?.codexPath;
            return connect(codexPath);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/initialize",
        title: "Initialize Codex app-server",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: () => Effect.promise(initialize)
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/request",
        title: "Raw Codex request",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            const payload = methodInput as { method?: string; params?: unknown };
            if (!payload.method) {
              throw new Error("codex/request requires method");
            }
            return request(payload.method, payload.params);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/threadStart",
        title: "Start Codex thread",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            return request("thread/start", methodInput);
          })
      })
    );

    await input.runPromise(
      input.methods.register({
        id: "codex/turnStart",
        title: "Start Codex turn",
        owner: { kind: "runtime", id: "plastic.codex-adapter" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            await ensureInitialized();
            return request("turn/start", methodInput);
          })
      })
    );
  };

  return {
    status,
    registerMethods
  };
};
