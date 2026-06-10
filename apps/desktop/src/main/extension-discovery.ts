import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { extensionFromManifest, type PlasticExtension } from "@plastic/core";

const extensionFileExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const manifestNames = ["plastic.extension.json"];
const entryNames = ["index.tsx", "index.ts", "main.ts", "main.tsx", "index.js", "main.js"];

export const normalizeId = (value: string): string =>
  value
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

export const relativePath = (workspaceDir: string, path: string): string => relative(workspaceDir, path) || ".";

export const readJson = async (path: string): Promise<{ value: unknown; error?: string }> => {
  try {
    return { value: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    return {
      value: {},
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const discoverFileExtension = async (workspaceDir: string, path: string): Promise<PlasticExtension> => {
  const id = `workspace.${normalizeId(basename(path))}`;
  return extensionFromManifest({
    path: relativePath(workspaceDir, path),
    entry: relativePath(workspaceDir, path),
    manifest: {
      id,
      title: basename(path, extname(path)),
      panels: [
        {
          id: `${id}.panel`,
          title: basename(path, extname(path)),
          kind: "extension"
        }
      ]
    },
    fallbackId: id,
    source: "workspace"
  });
};

export const discoverFolderExtension = async (workspaceDir: string, path: string): Promise<PlasticExtension> => {
  const errors: string[] = [];
  const files = await readdir(path);
  const manifestName = manifestNames.find((name) => files.includes(name));
  const manifestPath = manifestName ? join(path, manifestName) : undefined;
  const manifestResult = manifestPath ? await readJson(manifestPath) : { value: {} };
  if (manifestResult.error) {
    errors.push(manifestResult.error);
  }

  const entryName = entryNames.find((name) => files.includes(name));
  const entry = entryName ? join(path, entryName) : undefined;
  const id = `workspace.${normalizeId(basename(path))}`;

  if (!entry && !manifestPath) {
    errors.push("Folder extension has no manifest or supported entry file.");
  }

  const input: Parameters<typeof extensionFromManifest>[0] = {
    path: relativePath(workspaceDir, path),
    manifest: manifestResult.value,
    fallbackId: id,
    fallbackTitle: basename(path),
    source: "workspace",
    errors
  };
  if (entry) {
    input.entry = relativePath(workspaceDir, entry);
  }
  if (manifestPath) {
    input.manifestPath = relativePath(workspaceDir, manifestPath);
  }
  return extensionFromManifest(input);
};

const discoverBundledFolderExtension = async (workspaceDir: string, path: string): Promise<PlasticExtension> => {
  const files = await readdir(path);
  const manifestName = manifestNames.find((name) => files.includes(name));
  const manifestPath = manifestName ? join(path, manifestName) : undefined;
  const errors: string[] = [];

  if (!manifestPath) {
    errors.push("Bundled extension has no plastic.extension.json manifest.");
  }

  const manifestResult = manifestPath ? await readJson(manifestPath) : { value: {} };
  if (manifestResult.error) {
    errors.push(manifestResult.error);
  }
  const entryName = entryNames.find((name) => files.includes(name));
  const entry = entryName ? join(path, entryName) : undefined;

  return extensionFromManifest({
    path: relativePath(workspaceDir, path),
    ...(entry ? { entry: relativePath(workspaceDir, entry) } : {}),
    manifest: manifestResult.value,
    fallbackId: `plastic.${normalizeId(basename(path))}`,
    fallbackTitle: basename(path),
    source: "bundled",
    errors,
    ...(manifestPath ? { manifestPath: relativePath(workspaceDir, manifestPath) } : {})
  });
};

export const scanBundledExtensions = async (workspaceDir: string, bundledExtensionsDir: string): Promise<PlasticExtension[]> => {
  if (!await pathExists(bundledExtensionsDir)) {
    return [];
  }

  const entries = await readdir(bundledExtensionsDir);
  const extensions: PlasticExtension[] = [];

  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) {
      continue;
    }

    const path = join(bundledExtensionsDir, entry);
    const stats = await stat(path);
    if (stats.isDirectory()) {
      extensions.push(await discoverBundledFolderExtension(workspaceDir, path));
    }
  }

  return extensions;
};

export const scanWorkspaceExtensions = async (workspaceDir: string): Promise<PlasticExtension[]> => {
  const extensionsDir = join(workspaceDir, ".plastic", "extensions");
  if (!await pathExists(extensionsDir)) {
    return [];
  }

  const entries = await readdir(extensionsDir);
  const extensions: PlasticExtension[] = [];

  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) {
      continue;
    }

    const path = join(extensionsDir, entry);
    const stats = await stat(path);
    if (stats.isDirectory()) {
      extensions.push(await discoverFolderExtension(workspaceDir, path));
      continue;
    }

    if (stats.isFile() && extensionFileExtensions.has(extname(entry))) {
      extensions.push(await discoverFileExtension(workspaceDir, path));
    }
  }

  return extensions;
};
