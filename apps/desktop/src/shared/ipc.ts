export const ipcChannels = {
  rpcCall: "plastic:rpc-call",
  rpcEvent: "plastic:rpc-event"
} as const;

export interface RpcRequest {
  method: string;
  input?: unknown;
}

export interface RpcSuccess {
  ok: true;
  value: unknown;
}

export interface RpcFailure {
  ok: false;
  error: string;
}

export type RpcResponse = RpcSuccess | RpcFailure;

