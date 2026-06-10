import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const workspaceSlug = (workspaceDir: string) => {
  const name = workspaceDir.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase() || "workspace";
  const hash = createHash("sha256").update(workspaceDir).digest("hex").slice(0, 10);
  return `${safeName}-${hash}`;
};

export const resolvePlasticRuntimePaths = (workspaceDir: string) => {
  const dataDir = process.env.PLASTIC_DATA_DIR
    ?? join(homedir(), ".plastic", "workspaces", workspaceSlug(workspaceDir));
  const eventPath = process.env.PLASTIC_EVENT_PATH
    ?? join(dataDir, "events", "events.jsonl");

  return {
    dataDir,
    eventPath
  };
};
