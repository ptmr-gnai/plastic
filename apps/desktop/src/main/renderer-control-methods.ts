import { Effect } from "effect";
import { windowAvailability } from "./window-availability.js";
import type { RuntimeModule } from "./runtime-method-context.js";

export type RendererReloadResult = {
  windowId: number;
  reloaded: boolean;
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
