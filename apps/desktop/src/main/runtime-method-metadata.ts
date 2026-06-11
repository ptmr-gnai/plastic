export const noInputSchema = {
  type: "object",
  properties: {}
};

export const readOnlyEffects = {
  durableEvents: [],
  mutatesProjection: []
};

export const readOnlyReversibility = {
  reversible: true,
  notes: "Read-only method."
};
