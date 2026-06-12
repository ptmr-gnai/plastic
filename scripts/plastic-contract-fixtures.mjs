export const cleanupLegacyContractFixtures = async ({ assertArray, rpc, validationMeta }) => {
  const panels = assertArray(await rpc("panels/list"), "legacy cleanup panels/list is not an array");
  const fixtures = panels.filter((panel) =>
    typeof panel.id === "string"
    && panel.id.startsWith("contract-")
    && (
      panel.id.endsWith("-fallback-chat")
      || panel.id.endsWith("-panel")
      || panel.id.includes("-extension.panel")
    )
  );
  for (const panel of fixtures) {
    await rpc("panels/close", { id: panel.id, meta: validationMeta });
  }
  return { removedPanels: fixtures.length };
};

export const assertNoActiveContractFixtures = async ({ assert, assertArray, rpc }) => {
  const panels = assertArray(await rpc("panels/list"), "fixture stability panels/list is not an array");
  const extensions = assertArray(await rpc("extensions/list"), "fixture stability extensions/list is not an array");
  const activePanels = panels
    .filter((panel) => typeof panel.id === "string" && panel.id.startsWith("contract-"))
    .map((panel) => panel.id)
    .sort();
  const activeExtensions = extensions
    .filter((extension) => typeof extension.id === "string" && extension.id.startsWith("workspace.contract-"))
    .map((extension) => extension.id)
    .sort();
  assert(activePanels.length === 0, `active contract panels remain: ${activePanels.join(", ")}`);
  assert(activeExtensions.length === 0, `active contract extensions remain: ${activeExtensions.join(", ")}`);
  return {
    activeContractPanels: activePanels.length,
    activeContractExtensions: activeExtensions.length,
    panels: panels.length,
    extensions: extensions.length
  };
};

export const assertHeadlessFallbackChatFixture = async ({
  assert,
  assertArray,
  assertEventsTagged,
  itemsFrom,
  rpc,
  runId,
  validationMeta,
  validationTags
}) => {
  const chatId = `${runId}-fallback-chat`;
  const created = await rpc("chats/createCodexChat", {
    id: chatId,
    title: "Contract Fallback Chat",
    meta: validationMeta
  });
  assert(created.chatId === chatId, "fallback chat returned wrong id");
  assert(created.threadId === null, "fallback chat should not bind a Codex thread");
  const sent = await rpc("chats/sendToCodex", {
    chatId,
    content: "Contract fallback message",
    meta: validationMeta
  });
  assert(sent.userEvent?.id, "fallback send missing user event");
  assert(sent.agentEvent?.id, "fallback send missing agent event");
  const timeline = await rpc("events/timeline", { scope: { panelId: chatId }, limit: 10 });
  const timelineItems = itemsFrom(timeline, "fallback timeline returned no items");
  assert(timelineItems.some((item) => item.eventId === sent.userEvent.id), "fallback user event missing from timeline");
  const fallbackEvents = await rpc("events/list", {
    types: ["panel.created", "chat.agent_message.completed", "chat.user_message.submitted"],
    scope: { panelId: chatId },
    limit: 10
  });
  assertEventsTagged(assertArray(fallbackEvents, "fallback chat events/list is not an array"), validationTags, "fallback chat validation tags not readable");
  await rpc("panels/close", { id: chatId, meta: validationMeta });
  const panels = await rpc("panels/list");
  assert(!panels.some((panel) => panel.id === chatId), "fallback chat still projected after cleanup");
  return {
    chatId,
    createEventId: created.panelEvent.id,
    userEventId: sent.userEvent.id,
    agentEventId: sent.agentEvent.id,
    cleanedUp: true
  };
};
