import type { MethodRegistry } from "@plastic/core";
import type { RunPromise } from "./runtime-method-context.js";

export type RuntimeRpcResult =
  | {
      ok: true;
      value: unknown;
    }
  | {
      ok: false;
      error: string;
    };

export const callRuntimeRpcMethod = async (input: {
  methods: MethodRegistry;
  runPromise: RunPromise;
  method: string;
  value?: unknown;
}): Promise<RuntimeRpcResult> => {
  try {
    const value = await input.runPromise(input.methods.call(input.method, input.value));
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};
