import { contextBridge, ipcRenderer } from "electron";

const rpcCallChannel = "plastic:rpc-call";

interface RpcRequest {
  method: string;
  input?: unknown;
}

interface RpcSuccess {
  ok: true;
  value: unknown;
}

interface RpcFailure {
  ok: false;
  error: string;
}

type RpcResponse = RpcSuccess | RpcFailure;

const api = {
  call: async (method: string, input?: unknown): Promise<unknown> => {
    const request: RpcRequest = { method, input };
    const response = await ipcRenderer.invoke(rpcCallChannel, request) as RpcResponse;
    if (!response.ok) {
      throw new Error(response.error);
    }
    return response.value;
  }
};

contextBridge.exposeInMainWorld("plastic", api);
