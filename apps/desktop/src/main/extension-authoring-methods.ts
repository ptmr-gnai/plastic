import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type { RuntimeModule } from "./runtime-method-context.js";

type ScaffoldExtensionInput = {
  id?: string;
  title?: string;
  panelId?: string;
  panelTitle?: string;
  body?: string;
  kind?: string;
};

export const createExtensionAuthoringModule = (input: {
  plasticDir: string;
}): RuntimeModule => ({
  id: "extension-authoring",
  register: async ({ methods, runPromise, appendEvent }) => {
    await runPromise(
      methods.register({
        id: "extensions/scaffold",
        title: "Scaffold extension",
        description: "Creates a simple workspace extension under .plastic/extensions and records the scaffold event.",
        owner: { kind: "runtime", id: "plastic.runtime" },
        handler: (methodInput) =>
          Effect.promise(async () => {
            const extensionInput = methodInput as ScaffoldExtensionInput;
            const rawId = extensionInput.id ?? `agent-panel-${crypto.randomUUID().slice(0, 8)}`;
            const safeId = rawId
              .replace(/^workspace\./, "")
              .replace(/[^a-zA-Z0-9._-]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .toLowerCase();
            if (!safeId) {
              throw new Error("extensions/scaffold requires a usable id");
            }

            const extensionId = `workspace.${safeId}`;
            const panelId = extensionInput.panelId ?? `${safeId}.panel`;
            const title = extensionInput.title ?? extensionInput.panelTitle ?? safeId;
            const panelTitle = extensionInput.panelTitle ?? title;
            const extensionDir = join(input.plasticDir, "extensions", safeId);
            const manifestPath = join(extensionDir, "plastic.extension.json");
            const entryPath = join(extensionDir, "index.tsx");
            const manifest = {
              id: extensionId,
              title,
              panels: [
                {
                  id: panelId,
                  title: panelTitle,
                  kind: extensionInput.kind ?? "extension",
                  subtitle: "Workspace extension",
                  body: extensionInput.body ?? `Generated extension panel ${panelTitle}.`
                }
              ],
              methods: []
            };

            await mkdir(extensionDir, { recursive: true });
            await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
            await writeFile(
              entryPath,
              [
                "export default {",
                `  id: ${JSON.stringify(extensionId)},`,
                `  title: ${JSON.stringify(title)}`,
                "};",
                ""
              ].join("\n"),
              "utf8"
            );
            const event = await appendEvent({
              type: "extension.scaffolded",
              payload: {
                id: extensionId,
                title,
                panelId,
                extensionDir,
                manifestPath,
                entryPath
              },
              scope: { extensionId }
            });
            return { extensionId, panelId, extensionDir, manifestPath, entryPath, manifest, eventId: event.id };
          })
      })
    );
  }
});
