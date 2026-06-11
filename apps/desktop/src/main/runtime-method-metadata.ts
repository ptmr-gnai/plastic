import type { PlasticEventMeta, PlasticLink } from "@plastic/core";

export const noInputSchema = {
  type: "object",
  properties: {}
};

export const eventMetaSchema = {
  type: "object",
  description: "Optional event metadata, such as tags for validation or agent-scoped actions.",
  properties: {
    tags: { type: "array", items: { type: "string" } }
  }
};

export const readOnlyEffects = {
  durableEvents: [],
  mutatesProjection: []
};

export const readOnlyReversibility = {
  reversible: true,
  notes: "Read-only method."
};

export const mergeEventMetaLinks = (
  meta: PlasticEventMeta | undefined,
  links: PlasticLink[]
): PlasticEventMeta => ({
  ...(meta ?? {}),
  links: [...(meta?.links ?? []), ...links]
});
