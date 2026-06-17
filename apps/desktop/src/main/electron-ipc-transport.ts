import type { IpcMain } from "electron";
import { ipcChannels, type RpcRequest, type RpcResponse } from "../shared/ipc.js";
import type { MethodRegistry } from "@plastic/core";
import type { RunPromise } from "./runtime-method-context.js";
import { callRuntimeRpcMethod } from "./runtime-rpc-dispatch.js";

export type ElectronIpcTransport = {
  close: () => void;
};

export const startElectronIpcTransport = (input: {
  ipcMain: IpcMain;
  methods: MethodRegistry;
  runPromise: RunPromise;
}): ElectronIpcTransport => {
  input.ipcMain.handle(ipcChannels.rpcCall, async (_event, request: RpcRequest): Promise<RpcResponse> => {
    const response = await callRuntimeRpcMethod({
      methods: input.methods,
      runPromise: input.runPromise,
      method: request.method,
      value: request.input
    });
    return toJsonBoundary(response);
  });

  return {
    close: () => {
      input.ipcMain.removeHandler(ipcChannels.rpcCall);
    }
  };
};

const toJsonBoundary = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;
