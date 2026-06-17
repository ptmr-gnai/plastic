import { Effect } from "effect";
import { noInputSchema } from "./runtime-method-metadata.js";
import { windowAvailability } from "./window-availability.js";
import type { RuntimeModule } from "./runtime-method-context.js";

export type RendererReloadResult = {
  windowId: number;
  reloaded: boolean;
};

const rendererReloadOutputSchema = {
  type: "object",
  required: ["ok"],
  properties: {
    ok: { type: "boolean" },
    reason: { type: "string" },
    availability: { type: "object" },
    windows: {
      type: "array",
      items: {
        type: "object",
        required: ["windowId", "reloaded"],
        properties: {
          windowId: { type: "number" },
          reloaded: { type: "boolean" }
        }
      }
    }
  }
};

export const createRendererControlModule = (input: {
  reloadRenderers?: () => RendererReloadResult[];
}): RuntimeModule => ({
  id: "renderer-control",
  register: async ({ capabilities, methods, runPromise }) => {
    const availability = windowAvailability(capabilities, "renderer/reload");

    await runPromise(
      methods.register({
        id: "renderer/reload",
        title: "Reload renderer",
        description: "Reloads all Electron renderer windows when the current host has renderer windows.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        availability,
        inputSchema: noInputSchema,
        outputSchema: rendererReloadOutputSchema,
        examples: [{ title: "Reload renderer windows", input: {}, verifyWith: { method: "runtime/capabilities", input: {} } }],
        effects: { durableEvents: [], mutatesProjection: [] },
        reversibility: { reversible: false, notes: "Renderer reload changes transient host state." },
        handler: () =>
          Effect.sync(() => {
            if (availability.status !== "available" || !input.reloadRenderers) {
              return {
                ok: false,
                reason: "renderer unavailable",
                availability
              };
            }
            return {
              ok: true,
              windows: input.reloadRenderers()
            };
          })
      })
    );
  }
});
