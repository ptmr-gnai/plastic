export const expectedMethodIds = [
  "agent/orient",
  "agent/workbench",
  "app/diagnostics",
  "app/setTheme",
  "bridge/callPlasticRpcTool",
  "bridge/configurePlasticMcp",
  "bridge/status",
  "bridge/test",
  "build/status",
  "build/typecheck",
  "chats/addButton",
  "chats/bindCodexThread",
  "chats/close",
  "chats/createCodexChat",
  "chats/getBinding",
  "chats/injectUserMessage",
  "chats/interrupt",
  "chats/messages",
  "chats/sendToCodex",
  "chats/startCodexThread",
  "codex/configRead",
  "codex/connect",
  "codex/defaults",
  "codex/initialize",
  "codex/modelList",
  "codex/request",
  "codex/setDefaults",
  "codex/status",
  "codex/threadArchive",
  "codex/threadFork",
  "codex/threadList",
  "codex/threadNameSet",
  "codex/threadRead",
  "codex/threadResume",
  "codex/threadStart",
  "codex/turnInterrupt",
  "codex/turnStart",
  "codex/turnSteer",
  "deixis/clickRef",
  "deixis/evalDom",
  "deixis/fillRef",
  "deixis/listVisibleRefs",
  "deixis/resolveRef",
  "deixis/verifyRefAction",
  "events/append",
  "events/list",
  "events/timeline",
  "extensions/activate",
  "extensions/forkBundled",
  "extensions/get",
  "extensions/list",
  "extensions/registerPanel",
  "extensions/scaffold",
  "extensions/scan",
  "extensions/verificationStatus",
  "extensions/verify",
  "extensions/verifyAll",
  "methods/describe",
  "panels/close",
  "panels/create",
  "panels/get",
  "panels/list",
  "panels/listMessages",
  "panels/mailboxes",
  "panels/markMessageRead",
  "panels/move",
  "panels/remove",
  "panels/rename",
  "panels/sendMessage",
  "plastic/methods",
  "plastic/selfTest",
  "plastic/snapshot",
  "plastic/state",
  "renderer/reload",
  "rpc/call",
  "runtime/auditStatus",
  "runtime/capabilities",
  "runtime/host",
  "runtime/modules",
  "windows/create",
  "windows/focusPanel",
  "windows/list",
  "windows/screenshot",
  "windows/scrollToRef"
].sort();

export function methodSurfaceDiff(actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((id) => !actualSet.has(id));
  const extra = actual.filter((id) => !expectedSet.has(id));
  return `missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`;
}

export function assertMethodCatalogSurface({ assert, label, methods }) {
  const methodIds = methods.map((method) => method.id).sort();
  assert(
    JSON.stringify(methodIds) === JSON.stringify(expectedMethodIds),
    `${label} method id surface changed: ${methodSurfaceDiff(methodIds, expectedMethodIds)}`
  );
  for (const method of methods) {
    assert(
      method.links?.some((link) => link.rel === "describe" && link.method === "methods/describe" && link.target === method.id),
      `${label} ${method.id} missing describe link`
    );
    assert(
      method.links?.some((link) => link.rel === "invoke" && link.method === "rpc/call" && link.target === method.id),
      `${label} ${method.id} missing invoke link`
    );
  }
}
