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
  examples?: Array<{
    title: string;
    input: unknown;
    expectedEvents?: string[];
    verifyWith?: {
      method: string;
      input: unknown;
    };
  }>;
  effects?: {
    durableEvents?: string[];
    mutatesProjection?: string[];
    opensWindow?: boolean;
    touchesFilesystem?: boolean;
    startsProcess?: boolean;
  };
  preconditions?: string[];
  reversibility?: {
    reversible: boolean;
    method?: string;
    notes?: string;
  };
  permissions?: string[];
  availability?: {
    status: "available" | "degraded" | "unavailable";
    requiredCapabilities?: string[];
    missingCapabilities?: string[];
    notes?: string;
  };
  links?: PlasticLink[];
  handler?: (input: unknown) => Effect.Effect<unknown>;
}

export interface MethodRegistry {
  register: (method: PlasticMethod) => Effect.Effect<PlasticMethod>;
  list: () => Effect.Effect<PlasticMethod[]>;
  get: (methodId: string) => Effect.Effect<PlasticMethod | undefined>;
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
    get: (methodId) => Effect.sync(() => methods.get(methodId)),
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
