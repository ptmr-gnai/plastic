import { readFile } from "node:fs/promises";
import { rpc, rpcUrl } from "./plastic-contract-helpers.mjs";

const methodPattern = /`([a-z][a-z0-9-]*(?:\/[A-Za-z0-9-]+)+)`/g;
const sectionStart = "### 4.4 Current Runtime Methods";
const sectionEnd = "### 4.5";

const unique = (items) => [...new Set(items)].sort();

const readDocumentedMethods = async () => {
  const document = await readFile("docs/ARCHITECTURE.md", "utf8");
  const start = document.indexOf(sectionStart);
  if (start === -1) {
    throw new Error(`docs/ARCHITECTURE.md missing section ${sectionStart}`);
  }
  const end = document.indexOf(sectionEnd, start);
  if (end === -1) {
    throw new Error(`docs/ARCHITECTURE.md missing section boundary ${sectionEnd}`);
  }
  return unique([...document.slice(start, end).matchAll(methodPattern)].map((match) => match[1]));
};

const documented = await readDocumentedMethods();
const live = unique((await rpc("plastic/methods", {})).map((method) => method.id));
const liveSet = new Set(live);
const documentedSet = new Set(documented);
const stale = documented.filter((id) => !liveSet.has(id));
const missing = live.filter((id) => !documentedSet.has(id));

const result = {
  ok: stale.length === 0 && missing.length === 0,
  rpcUrl,
  section: sectionStart,
  documented: documented.length,
  live: live.length,
  stale,
  missing
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}
