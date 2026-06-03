import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import ts from "typescript";
import {
  buildChatMessagesForPanel,
  createEvent,
  projectPanels,
  projectExtensions,
  type EventStore,
  type MethodRegistry,
  type PlasticEvent,
  type PlasticExtension,
  type PlasticMethod
} from "@plastic/core";

type RunPromise = <A>(effect: Effect.Effect<A, unknown>) => Promise<A>;

export interface ExtensionActivationContext {
  extension: PlasticExtension;
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  Effect: typeof Effect;
  core: {
    buildChatMessagesForPanel: typeof buildChatMessagesForPanel;
    createEvent: typeof createEvent;
    projectPanels: typeof projectPanels;
  };
  registerMethod: (method: PlasticMethod) => Promise<PlasticMethod>;
  appendEvent: (event: Parameters<typeof createEvent>[0]) => Promise<PlasticEvent>;
  listEvents: () => Promise<PlasticEvent[]>;
  mapEvents: <A>(project: (events: PlasticEvent[]) => A) => Effect.Effect<A, unknown>;
}

export type PlasticExtensionModule = {
  activate?: (context: ExtensionActivationContext) => unknown | Promise<unknown>;
};

const extensionBuildDir = (workspaceDir: string, extension: PlasticExtension) =>
  join(workspaceDir, ".plastic", "build", "extensions", extension.id.replace(/[^a-zA-Z0-9._-]+/g, "-"));

const compileExtensionMain = async (workspaceDir: string, extension: PlasticExtension, sourcePath: string) => {
  const source = await readFile(sourcePath, "utf8");
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  const outputDir = extensionBuildDir(workspaceDir, extension);
  const outputPath = join(outputDir, `${basename(sourcePath, extname(sourcePath))}-${hash}.mjs`);
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
      strict: true
    },
    fileName: sourcePath
  });

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, compiled.outputText, "utf8");
  return outputPath;
};

const resolveExtensionMain = (workspaceDir: string, extension: PlasticExtension) => {
  if (!extension.entry || !basename(extension.entry).startsWith("main.")) {
    return undefined;
  }
  return join(workspaceDir, extension.entry);
};

const importExtensionModule = async (workspaceDir: string, extension: PlasticExtension, sourcePath: string) => {
  const extensionName = extname(sourcePath);
  const importPath = extensionName === ".ts" || extensionName === ".tsx"
    ? await compileExtensionMain(workspaceDir, extension, sourcePath)
    : sourcePath;
  return import(`${pathToFileURL(importPath).href}?t=${Date.now()}`) as Promise<PlasticExtensionModule>;
};

const createActivationContext = (input: {
  extension: PlasticExtension;
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
}): ExtensionActivationContext => ({
  extension: input.extension,
  workspaceDir: input.workspaceDir,
  eventStore: input.eventStore,
  methods: input.methods,
  Effect,
  core: {
    buildChatMessagesForPanel,
    createEvent,
    projectPanels
  },
  registerMethod: (method) => input.runPromise(input.methods.register(method)),
  appendEvent: (event) => input.runPromise(input.eventStore.append(createEvent(event))),
  listEvents: () => input.runPromise(input.eventStore.list()),
  mapEvents: (project) => Effect.map(input.eventStore.list(), project)
});

export const activateExtensions = async (input: {
  workspaceDir: string;
  eventStore: EventStore;
  methods: MethodRegistry;
  runPromise: RunPromise;
  extensionId?: string;
}) => {
  const events = await input.runPromise(input.eventStore.list());
  const extensions = projectExtensions(events)
    .filter((extension) => !input.extensionId || extension.id === input.extensionId);
  const activated = [];
  const skipped = [];
  const failed = [];

  for (const extension of extensions) {
    const sourcePath = resolveExtensionMain(input.workspaceDir, extension);
    if (!sourcePath) {
      skipped.push({ extensionId: extension.id, reason: "no main entry" });
      continue;
    }

    try {
      const module = await importExtensionModule(input.workspaceDir, extension, sourcePath);
      if (typeof module.activate !== "function") {
        skipped.push({ extensionId: extension.id, reason: "main entry has no activate export" });
        continue;
      }
      await module.activate(createActivationContext({ ...input, extension }));
      const event = await input.runPromise(
        input.eventStore.append(
          createEvent({
            type: "extension.loaded",
            payload: { id: extension.id, entry: extension.entry },
            scope: { extensionId: extension.id }
          })
        )
      );
      activated.push({ extensionId: extension.id, entry: extension.entry, eventId: event.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const event = await input.runPromise(
        input.eventStore.append(
          createEvent({
            type: "extension.failed",
            payload: { id: extension.id, entry: extension.entry, error: message },
            scope: { extensionId: extension.id }
          })
        )
      );
      failed.push({ extensionId: extension.id, entry: extension.entry, error: message, eventId: event.id });
    }
  }

  return { activated, skipped, failed };
};
