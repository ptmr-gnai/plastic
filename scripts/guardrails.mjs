#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const strict = process.argv.includes("--strict");
const failOnWarnings = process.argv.includes("--fail-on-warnings");
const clayPattern = new RegExp(String.raw`\bclay\b|\.clay|C` + "lay");

const skippedDirs = new Set([
  ".git",
  ".plastic",
  "node_modules",
  "dist",
  "dist-electron",
  "vendor"
]);

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"]);
const tsExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const fileWarnLines = 500;
const fileFailLines = 800;
const cssWarnLines = 500;
const functionWarnLines = 80;
const functionFailLines = 140;

const allowlistedLargeFiles = new Map([
  ["apps/desktop/src/main/main.ts", "Known runtime god file; next plan extracts a shared runtime kernel."],
  ["docs/PROJECT_PLAN.md", "Historical planning document kept as reference material."]
]);

const warnings = [];
const failures = [];

const addWarning = (id, file, message) => warnings.push({ id, file, message });
const addFailure = (id, file, message) => failures.push({ id, file, message });

const toRepoPath = (path) => relative(root, path).replaceAll("\\", "/");

const walk = async (dir, files = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".plastic") {
      continue;
    }
    if (skippedDirs.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, files);
      continue;
    }
    files.push(path);
  }
  return files;
};

const lineCount = (text) => text.length === 0 ? 0 : text.split(/\r?\n/).length;

const checkFileSize = (file, text) => {
  const repoPath = toRepoPath(file);
  const lines = lineCount(text);
  const extension = extname(file);
  const warnLimit = extension === ".css" ? cssWarnLines : fileWarnLines;

  if (lines > fileFailLines && !allowlistedLargeFiles.has(repoPath)) {
    addFailure("file-size", repoPath, `${lines} lines exceeds hard limit ${fileFailLines}.`);
    return;
  }
  if (lines > warnLimit) {
    const suffix = allowlistedLargeFiles.has(repoPath)
      ? ` Allowlisted: ${allowlistedLargeFiles.get(repoPath)}`
      : "";
    addWarning("file-size", repoPath, `${lines} lines exceeds warning limit ${warnLimit}.${suffix}`);
  }
};

const functionName = (node) => {
  if ("name" in node && node.name?.getText) {
    return node.name.getText();
  }
  return ts.SyntaxKind[node.kind];
};

const checkFunctionSizes = (file, text) => {
  if (!tsExtensions.has(extname(file))) {
    return;
  }

  const repoPath = toRepoPath(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const end = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const lines = end - start + 1;
      const name = functionName(node);
      const message = `${name} spans ${lines} lines (${start}-${end}).`;
      if (lines > functionFailLines) {
        addFailure("function-size", repoPath, message);
      } else if (lines > functionWarnLines) {
        addWarning("function-size", repoPath, message);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
};

const checkPublicClayNames = (file, text) => {
  const repoPath = toRepoPath(file);
  if (repoPath === "scripts/guardrails.mjs") {
    return;
  }
  if (repoPath.startsWith("vendor/")) {
    return;
  }
  if (!clayPattern.test(text)) {
    return;
  }
  if (repoPath === "docs/RUNTIME_TRACTABILITY_AND_GUARDRAILS_PLAN.md" || repoPath === "AGENTS.md") {
    addWarning("naming", repoPath, "Contains historical Clay naming; keep public names converging on Plastic.");
    return;
  }
  addWarning("naming", repoPath, "Contains Clay naming. New public APIs should use Plastic.");
};

const checkMethodRegistration = (file, text) => {
  if (!tsExtensions.has(extname(file)) || !text.includes("methods.register")) {
    return;
  }
  const repoPath = toRepoPath(file);
  const registrationBlocks = text.match(/methods\.register\s*\(\s*\{[\s\S]*?\n\s*\}\s*\)/g) ?? [];
  for (const block of registrationBlocks) {
    const id = block.match(/\bid:\s*"([^"]+)"/)?.[1] ?? "unknown";
    if (!/\btitle:\s*(?:"[^"]+"|[\w.]+)/.test(block)) {
      addWarning("method-metadata", repoPath, `${id} is missing a title.`);
    }
    if (!/\bowner:\s*\{/.test(block)) {
      addWarning("method-metadata", repoPath, `${id} is missing owner metadata.`);
    }
    if (/owner:\s*\{\s*kind:\s*"extension"/.test(block) && repoPath.startsWith("apps/desktop/src/main/")) {
      addWarning("method-ownership", repoPath, `${id} is extension-owned but implemented in protected runtime.`);
    }
  }
};

const checkImportBoundaries = (file, text) => {
  const repoPath = toRepoPath(file);
  if (repoPath.includes("/renderer") && /from\s+["'].*\/main\//.test(text)) {
    addFailure("import-boundary", repoPath, "Renderer code imports main-process code.");
  }
  if (repoPath.includes(".plastic/extensions") && /apps\/desktop\/src\/main/.test(text)) {
    addFailure("import-boundary", repoPath, "Workspace extension imports protected main-process code.");
  }
  if (repoPath.endsWith("headless.ts") && /from\s+["']electron["']|require\(["']electron["']\)/.test(text)) {
    addFailure("import-boundary", repoPath, "Headless runtime imports Electron.");
  }
};

const checkExtensionManifest = async (file, text) => {
  if (basename(file) !== "plastic.extension.json") {
    return;
  }
  const repoPath = toRepoPath(file);
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    addFailure("extension-manifest", repoPath, `Invalid JSON: ${error.message}`);
    return;
  }
  if (typeof manifest.id !== "string" || manifest.id.length === 0) {
    addFailure("extension-manifest", repoPath, "Missing manifest id.");
  }
  const rendererIds = new Set((manifest.renderers ?? []).map((renderer) => renderer.id));
  for (const renderer of manifest.renderers ?? []) {
    if (typeof renderer.id === "string" && typeof manifest.id === "string" && !renderer.id.startsWith(`${manifest.id}.`)) {
      addWarning("extension-manifest", repoPath, `Renderer ${renderer.id} does not start with extension id ${manifest.id}.`);
    }
  }
  for (const panel of manifest.panels ?? []) {
    if (panel.rendererId && !rendererIds.has(panel.rendererId)) {
      addFailure("extension-manifest", repoPath, `Panel ${panel.id ?? "unknown"} references missing renderer ${panel.rendererId}.`);
    }
  }
  for (const method of manifest.methods ?? []) {
    if (typeof method === "string") {
      addWarning("extension-manifest", repoPath, `Method ${method} is declared as metadata only.`);
      continue;
    }
    if (!method.handler && method.metadataOnly !== true) {
      addWarning("extension-manifest", repoPath, `Method ${method.id ?? "unknown"} has no handler or metadataOnly marker.`);
    }
  }
};

const stagedFiles = () => {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-status"], { cwd: root, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split(/\s+/);
        return { status, path: pathParts.join(" ") };
      });
  } catch {
    return [];
  }
};

const checkStagedArtifacts = () => {
  for (const { status, path: file } of stagedFiles()) {
    if (status === "D") {
      continue;
    }
    if (/^\.plastic\/.*\.(png|jpg|jpeg|webp)$/.test(file)) {
      addWarning("runtime-artifact", file, "Screenshot/runtime image is staged.");
    }
    if (/^\.plastic\/events\/events\.jsonl$/.test(file)) {
      addWarning("runtime-artifact", file, "Runtime event log is staged; include only intentional fixtures or validation records.");
    }
    if (/(^|\/)(dist|dist-electron)\//.test(file)) {
      addFailure("runtime-artifact", file, "Generated build output is staged.");
    }
  }
};

const files = await walk(root);
for (const file of files) {
  const extension = extname(file);
  if (!sourceExtensions.has(extension) && basename(file) !== "plastic.extension.json" && extname(file) !== ".md") {
    continue;
  }
  const text = await readFile(file, "utf8");
  if (sourceExtensions.has(extension) || extname(file) === ".md") {
    checkFileSize(file, text);
  }
  checkFunctionSizes(file, text);
  checkPublicClayNames(file, text);
  checkMethodRegistration(file, text);
  checkImportBoundaries(file, text);
  await checkExtensionManifest(file, text);
}
checkStagedArtifacts();

const printGroup = (title, items) => {
  if (items.length === 0) {
    return;
  }
  console.log(`\n${title}`);
  for (const item of items) {
    console.log(`- [${item.id}] ${item.file}: ${item.message}`);
  }
};

console.log(`Guardrails checked ${files.length} files.`);
if (!strict && !failOnWarnings) {
  console.log("Report-only mode. Use --strict to fail on hard findings or --fail-on-warnings to fail on any finding.");
}
printGroup("Warnings", warnings);
printGroup("Failures", failures);

if ((strict && failures.length > 0) || (failOnWarnings && (warnings.length > 0 || failures.length > 0))) {
  process.exitCode = 1;
}
