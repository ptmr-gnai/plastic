import { Effect } from "effect";
import type { PlasticLink } from "./events.js";

export interface PlasticAction {
  id: string;
  title: string;
  method: string;
  inputSchema?: unknown;
  description?: string;
}

export interface PlasticResource<T = unknown> {
  id: string;
  kind: string;
  title?: string;
  state: T;
  links: PlasticLink[];
  actions: PlasticAction[];
}

export interface PlasticMethod {
  id: string;
  title: string;
  description?: string;
  owner: {
    kind: "runtime" | "extension" | "agent" | "panel";
    id: string;
  };
  inputSchema?: unknown;
  outputSchema?: unknown;
  permissions?: string[];
  links?: PlasticLink[];
  handler?: (input: unknown) => Effect.Effect<unknown>;
}

export interface MethodRegistry {
  register: (method: PlasticMethod) => Effect.Effect<PlasticMethod>;
  list: () => Effect.Effect<PlasticMethod[]>;
  call: (methodId: string, input: unknown) => Effect.Effect<unknown, Error>;
}

export const createMethodRegistry = (): MethodRegistry => {
  const methods = new Map<string, PlasticMethod>();

  return {
    register: (method) =>
      Effect.sync(() => {
        methods.set(method.id, method);
        return method;
      }),
    list: () => Effect.sync(() => [...methods.values()]),
    call: (methodId, input) =>
      Effect.flatMap(
        Effect.sync(() => methods.get(methodId)),
        (method) => {
          if (!method?.handler) {
            return Effect.fail(new Error(`RPC method not found or has no handler: ${methodId}`));
          }
          return method.handler(input);
        }
      )
  };
};

