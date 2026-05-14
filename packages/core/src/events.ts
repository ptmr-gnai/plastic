export type PlasticActorKind = "user" | "agent" | "extension" | "system" | "cron";

export interface PlasticActor {
  kind: PlasticActorKind;
  id: string;
  name?: string;
}

export interface PlasticScope {
  workspaceId: string;
  windowId?: string;
  panelId?: string;
  extensionId?: string;
  agentId?: string;
  projectDir?: string;
}

export interface PlasticLink {
  rel: string;
  href: string;
  method?: string;
  target?: string;
}

export interface PlasticRedaction {
  path: string;
  reason: string;
}

export interface PlasticEventMeta {
  tags?: string[];
  links?: PlasticLink[];
  redactions?: PlasticRedaction[];
  transient?: false;
}

export interface PlasticEvent<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  version: number;
  timestamp: string;
  actor: PlasticActor;
  scope: PlasticScope;
  correlationId?: string;
  causationId?: string;
  payload: TPayload;
  meta: PlasticEventMeta;
}

export const systemActor: PlasticActor = {
  kind: "system",
  id: "plastic.runtime",
  name: "Plastic Runtime"
};

export const createEvent = <TType extends string, TPayload>(input: {
  type: TType;
  payload: TPayload;
  scope?: Partial<PlasticScope>;
  actor?: PlasticActor;
  correlationId?: string;
  causationId?: string;
  meta?: PlasticEventMeta;
}): PlasticEvent<TType, TPayload> => {
  const event: PlasticEvent<TType, TPayload> = {
    id: crypto.randomUUID(),
    type: input.type,
    version: 1,
    timestamp: new Date().toISOString(),
    actor: input.actor ?? systemActor,
    scope: {
      workspaceId: input.scope?.workspaceId ?? "default",
      ...input.scope
    },
    payload: input.payload,
    meta: input.meta ?? {}
  };

  if (input.correlationId) {
    event.correlationId = input.correlationId;
  }

  if (input.causationId) {
    event.causationId = input.causationId;
  }

  return event;
};
