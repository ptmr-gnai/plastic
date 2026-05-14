import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels, type RpcRequest, type RpcResponse } from "../shared/ipc.js";

const api = {
  call: async (method: string, input?: unknown): Promise<unknown> => {
    const response = await ipcRenderer.invoke(ipcChannels.rpcCall, { method, input } satisfies RpcRequest) as RpcResponse;
    if (!response.ok) {
      throw new Error(response.error);
    }
    return response.value;
  }
};

contextBridge.exposeInMainWorld("plastic", api);

