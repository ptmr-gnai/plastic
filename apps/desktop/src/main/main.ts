import { app, BrowserWindow, ipcMain } from "electron";
import { Effect } from "effect";
import { createEvent, createMemoryEventStore, createMethodRegistry, buildPlasticState } from "@plastic/core";
import { ipcChannels, type RpcRequest, type RpcResponse } from "../shared/ipc.js";

const eventStore = createMemoryEventStore();
const methods = createMethodRegistry();

const runPromise = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

const registerRuntimeMethods = async () => {
  await runPromise(
    methods.register({
      id: "plastic/state",
      title: "Plastic state",
      description: "Returns HATEOAS-style app state.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => buildPlasticState(eventStore, methods)
    })
  );

  await runPromise(
    methods.register({
      id: "plastic/methods",
      title: "Plastic methods",
      description: "Lists all registered RPC methods.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => methods.list()
    })
  );

  await runPromise(
    methods.register({
      id: "events/list",
      title: "List events",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: () => eventStore.list()
    })
  );

  await runPromise(
    methods.register({
      id: "app/setTheme",
      title: "Set theme",
      owner: { kind: "runtime", id: "plastic.runtime" },
      handler: (input) => {
        const theme = (input as { theme?: "light" | "dark" }).theme === "dark" ? "dark" : "light";
        return eventStore.append(
          createEvent({
            type: "theme.changed",
            payload: { theme }
          })
        );
      }
    })
  );
};

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Plastic",
    webPreferences: {
      preload: new URL("../preload/preload.js", import.meta.url).pathname,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await window.loadFile(new URL("../../dist/index.html", import.meta.url).pathname);
  }
};

ipcMain.handle(ipcChannels.rpcCall, async (_event, request: RpcRequest): Promise<RpcResponse> => {
  try {
    const value = await runPromise(methods.call(request.method, request.input));
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

await registerRuntimeMethods();
await runPromise(
  eventStore.append(
    createEvent({
      type: "runtime.started",
      payload: {
        version: app.getVersion()
      }
    })
  )
);

await app.whenReady();
await createWindow();

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
