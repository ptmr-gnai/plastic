import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import { Effect } from "effect";
import {
  buildTimeline,
  createEvent,
  eventSummary,
  isNoisyEvent,
  projectExtensions,
  projectPanels,
  type EventScopeInput,
  type PlasticEvent,
  type TimelineInput
} from "@plastic/core";
import type { RefInput, ScreenshotInput, VerifyRefActionInput } from "./deixis-types.js";
import { availabilityFromCapabilities, type RuntimeMethodContext, type RuntimeModule } from "./runtime-method-context.js";

type ResolvedVisibleRef = {
  windowId: number;
  ref: {
    ref?: string;
    panel?: string;
    extension?: string;
    command?: string;
    tag: string;
    text: string;
    bounds?: unknown;
  };
} | null;

type DeixisMethodHost = {
  captureWindow: (input?: ScreenshotInput) => Promise<unknown>;
  findWindow: (windowId?: number) => ElectronBrowserWindow | null;
  listVisibleRefs: () => Promise<unknown>;
  panelIdFromRef: (ref: string) => string | undefined;
  resolveVisibleRef: (ref: string) => Promise<ResolvedVisibleRef>;
  scrollRefIntoViewScript: (ref: string) => string;
  sourceHintsFor: (input: { ref?: string; panelId?: string; extensionId?: string; command?: string }) => string[];
};

export const createDeixisMethodModule = (host: Partial<DeixisMethodHost> = {}): RuntimeModule => ({
  id: "deixis",
  register: async (context) => {
    await registerListVisibleRefs(context, host);
    await registerScreenshot(context, host);
    await registerResolveRef(context, host);
    await registerEvalDom(context, host);
    await registerVerifyRefAction(context, host);
    await registerClickRef(context, host);
    await registerFillRef(context, host);
  }
});

const registerListVisibleRefs = async (
  context: RuntimeMethodContext,
  host: Partial<DeixisMethodHost>
) => {
  const { methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "deixis/listVisibleRefs",
      title: "List visible UI references",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: availabilityFromCapabilities(
        context.capabilities,
        ["dom.refs"],
        "Requires a rendered DOM that exposes data-plastic-ref elements."
      ),
      handler: () => Effect.promise(async () => {
        if (!host.listVisibleRefs) {
          throw new Error("deixis/listVisibleRefs is unavailable: missing dom.refs capability");
        }
        return host.listVisibleRefs();
      })
    })
  );
};

const registerScreenshot = async (
  context: RuntimeMethodContext,
  host: Partial<DeixisMethodHost>
) => {
  const { methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "windows/screenshot",
      title: "Capture window screenshot",
      description: "Captures the focused window, a specific window id, or a visible data-plastic-ref region as a data URL.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: availabilityFromCapabilities(
        context.capabilities,
        ["electron.window", "screenshot"],
        "Requires a host that can capture Electron BrowserWindow pixels."
      ),
      handler: (input) => Effect.promise(async () => {
        if (!host.captureWindow) {
          throw new Error("windows/screenshot is unavailable: missing electron.window or screenshot capability");
        }
        return host.captureWindow(input as ScreenshotInput | undefined);
      })
    })
  );
};

const registerResolveRef = async (
  context: RuntimeMethodContext,
  host: Partial<DeixisMethodHost>
) => {
  const { eventStore, methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "deixis/resolveRef",
      title: "Resolve visible UI reference",
      description: "Explains a data-plastic-ref with DOM, panel, extension, command, source hints, and recent event lineage.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: availabilityFromCapabilities(
        context.capabilities,
        ["dom.refs"],
        "Requires visible data-plastic-ref elements in a rendered DOM."
      ),
      handler: (input) =>
        Effect.promise(async () => {
          if (!host.resolveVisibleRef || !host.panelIdFromRef || !host.sourceHintsFor) {
            throw new Error("deixis/resolveRef is unavailable: missing dom.refs capability");
          }
          const ref = (input as { ref?: string }).ref;
          if (!ref) {
            throw new Error("deixis/resolveRef requires ref");
          }

          const events = await runPromise(eventStore.list());
          const panels = projectPanels(events);
          const extensions = projectExtensions(events);
          const visible = await host.resolveVisibleRef(ref);
          const panelId = visible?.ref.panel ?? host.panelIdFromRef(ref);
          const panel = panelId ? panels.find((candidate) => candidate.id === panelId) : undefined;
          const extensionId = visible?.ref.extension ?? panel?.extensionId;
          const extension = extensionId ? extensions.find((candidate) => candidate.id === extensionId) : undefined;
          const isChatCompose = ref.startsWith("chat-compose:");
          const command = visible?.ref.command ?? (isChatCompose ? "chats/sendToCodex" : undefined);
          const lineage = findRecentEvents(
            events,
            (event) =>
              !isNoisyEvent(event) && (
                event.scope.panelId === panelId ||
                event.scope.extensionId === extensionId ||
                event.type.includes(panelId ?? "__no_panel__") ||
                event.type.includes(extensionId ?? "__no_extension__")
              ),
            12
          );
          const refTimelineInput: TimelineInput = { limit: 12 };
          if (panelId) {
            refTimelineInput.scope = { panelId };
          }
          const timeline = buildTimeline(events, refTimelineInput);
          const binding = panelId && panel?.kind === "chat"
            ? await runPromise(methods.call("chats/getBinding", { chatId: panelId })).catch((error) => ({
              error: error instanceof Error ? error.message : String(error)
            }))
            : null;

          const sourceHintInput: { ref?: string; panelId?: string; extensionId?: string; command?: string } = { ref };
          if (panelId) {
            sourceHintInput.panelId = panelId;
          }
          if (extensionId) {
            sourceHintInput.extensionId = extensionId;
          }
          if (command) {
            sourceHintInput.command = command;
          }

          return {
            ref,
            element: visible ? {
              windowId: visible.windowId,
              tag: visible.ref.tag,
              text: visible.ref.text,
              bounds: visible.ref.bounds ?? null,
              attributes: {
                "data-plastic-ref": visible.ref.ref ?? ref,
                ...(visible.ref.panel ? { "data-plastic-panel": visible.ref.panel } : {}),
                ...(visible.ref.extension ? { "data-plastic-extension": visible.ref.extension } : {}),
                ...(visible.ref.command ? { "data-plastic-command": visible.ref.command } : {})
              }
            } : null,
            visible,
            ownership: {
              panelId: panelId ?? null,
              extensionId: extensionId ?? null,
              methodId: command ?? null,
              commandId: command ?? null,
              agentId: panel?.kind === "chat" ? "codex" : null
            },
            state: {
              panel: panel ?? null,
              extension: extension ?? null,
              binding,
              timeline,
              resourceLinks: [
                ...(panelId ? [{ rel: "panel", href: "panels/get", method: "panels/get", target: panelId }] : []),
                ...(extensionId ? [{ rel: "extension", href: "extensions/get", method: "extensions/get", target: extensionId }] : []),
                ...(panelId ? [{ rel: "timeline", href: "events/timeline", method: "events/timeline", target: panelId }] : [])
              ]
            },
            panel,
            extension,
            command,
            sourceHints: host.sourceHintsFor(sourceHintInput),
            lineage,
            verification: [
              ...(panelId ? [
                { id: "verify-ref-action", title: "Verify ref action", method: "deixis/verifyRefAction", input: { ref, panelId, limit: 30 } },
                { id: "timeline-after-action", title: "Verify panel timeline", method: "events/timeline", input: { scope: { panelId }, limit: 12 } }
              ] : []),
              { id: "visible-after-action", title: "Verify visible refs", method: "deixis/listVisibleRefs" },
              { id: "screenshot-after-action", title: "Verify screenshot", method: "windows/screenshot", input: { ref } }
            ],
            actions: [
              ...(panelId ? [
                { id: "get-panel", title: "Get panel", method: "panels/get", input: { id: panelId } },
                { id: "rename-panel", title: "Rename panel", method: "panels/rename" }
              ] : []),
              ...(isChatCompose && panelId ? [
                { id: "fill-compose", title: "Fill chat compose", method: "deixis/fillRef", input: { ref, value: "" } },
                { id: "send-compose", title: "Submit chat compose", method: "deixis/clickRef", input: { ref } },
                { id: "send-chat-direct", title: "Send chat message directly", method: "chats/sendToCodex", input: { chatId: panelId, content: "" } }
              ] : []),
              ...(extensionId ? [
                { id: "get-extension", title: "Get extension", method: "extensions/get", input: { id: extensionId } }
              ] : []),
              ...(command ? [
                { id: "invoke-command", title: "Invoke command", method: command }
              ] : [])
            ]
          };
        })
    })
  );
};

const registerEvalDom = async (
  context: RuntimeMethodContext,
  host: Partial<DeixisMethodHost>
) => {
  const { methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "deixis/evalDom",
      title: "Evaluate DOM script",
      description: "Permissive v0 DOM evaluation in the focused window.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: availabilityFromCapabilities(
        context.capabilities,
        ["dom.eval"],
        "Requires a renderer DOM execution host."
      ),
      handler: (input) =>
        Effect.promise(async () => {
          if (!host.findWindow) {
            throw new Error("deixis/evalDom is unavailable: missing dom.eval capability");
          }
          const code = (input as { code?: string }).code;
          if (!code) {
            throw new Error("Missing DOM eval code");
          }
          const target = host.findWindow();
          if (!target) {
            throw new Error("No window available");
          }
          return target.webContents.executeJavaScript(code);
        })
    })
  );
};

const registerVerifyRefAction = async (
  context: RuntimeMethodContext,
  host: Partial<DeixisMethodHost>
) => {
  const { eventStore, methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "deixis/verifyRefAction",
      title: "Verify ref action",
      description: "Verifies that a recent ref-driven action produced the expected durable event.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: availabilityFromCapabilities(
        context.capabilities,
        ["dom.refs", "event.projection"],
        "Requires visible refs plus the durable event projection."
      ),
      handler: (input) =>
        Effect.promise(async () => {
          if (!host.panelIdFromRef) {
            throw new Error("deixis/verifyRefAction is unavailable: missing dom.refs capability");
          }
          const verifyInput = input as VerifyRefActionInput;
          if (!verifyInput.ref) {
            throw new Error("deixis/verifyRefAction requires ref");
          }
          const events = await runPromise(eventStore.list());
          const panelId = verifyInput.panelId ?? host.panelIdFromRef(verifyInput.ref);
          const afterIndex = verifyInput.after ? events.findIndex((event) => event.id === verifyInput.after) : -1;
          const candidates = events
            .slice(afterIndex >= 0 ? afterIndex + 1 : Math.max(0, events.length - (verifyInput.limit ?? 200)))
            .filter((event) => {
              if (panelId && event.scope.panelId !== panelId) {
                return false;
              }
              if (verifyInput.expectedEventType && event.type !== verifyInput.expectedEventType) {
                return false;
              }
              if (verifyInput.expectedContent) {
                const payload = asRecord(event.payload);
                const content = asString(payload.content) ?? "";
                if (content !== verifyInput.expectedContent) {
                  return false;
                }
              }
              return true;
            });
          const refEvents = events
            .slice(afterIndex >= 0 ? afterIndex + 1 : Math.max(0, events.length - (verifyInput.limit ?? 200)))
            .filter((event) => {
              const payload = asRecord(event.payload);
              return (event.type === "deixis.ref.filled" || event.type === "deixis.ref.clicked") && payload.ref === verifyInput.ref;
            });
          const timelineInput: TimelineInput = { limit: Math.min(verifyInput.limit ?? 20, 100) };
          if (panelId) {
            timelineInput.scope = { panelId };
          }
          if (verifyInput.after) {
            timelineInput.after = verifyInput.after;
          }
          const timeline = buildTimeline(events, timelineInput);
          const ok = candidates.length > 0;
          const result = {
            ok,
            ref: verifyInput.ref,
            panelId: panelId ?? null,
            expectedEventType: verifyInput.expectedEventType ?? null,
            expectedContent: verifyInput.expectedContent ?? null,
            matchedEvents: candidates.slice(-10).map((event) => ({
              eventId: event.id,
              type: event.type,
              timestamp: event.timestamp,
              summary: eventSummary(event),
              payload: event.payload
            })),
            refEvents: refEvents.slice(-10).map((event) => ({
              eventId: event.id,
              type: event.type,
              timestamp: event.timestamp,
              payload: event.payload
            })),
            latestEventId: events.at(-1)?.id ?? null,
            eventCursor: events.at(-1)?.id ?? null,
            timeline
          };
          const event = await runPromise(
            eventStore.append(
              createEvent({
                type: "deixis.ref_action.verified",
                payload: result,
                ...(panelId ? { scope: { panelId } } : {})
              })
            )
          );
          return { ...result, verificationEventId: event.id };
        })
    })
  );
};

const registerClickRef = async (
  context: RuntimeMethodContext,
  host: Partial<DeixisMethodHost>
) => {
  const { eventStore, methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "deixis/clickRef",
      title: "Click visible UI reference",
      description: "Clicks a visible data-plastic-ref in the focused or selected window and records the action.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: availabilityFromCapabilities(
        context.capabilities,
        ["dom.refs", "dom.input"],
        "Requires a rendered DOM and input control."
      ),
      handler: (input) =>
        Effect.promise(async () => {
          if (!host.findWindow || !host.resolveVisibleRef || !host.panelIdFromRef || !host.scrollRefIntoViewScript) {
            throw new Error("deixis/clickRef is unavailable: missing dom.refs or dom.input capability");
          }
          const domHost = {
            findWindow: host.findWindow,
            resolveVisibleRef: host.resolveVisibleRef,
            panelIdFromRef: host.panelIdFromRef,
            scrollRefIntoViewScript: host.scrollRefIntoViewScript
          };
          const refInput = input as RefInput;
          if (!refInput.ref) {
            throw new Error("deixis/clickRef requires ref");
          }
          const latestFilledValue = await runPromise(eventStore.list()).then((events) => {
            const filled = events
              .filter((event) => event.type === "deixis.ref.filled")
              .map((event) => asRecord(event.payload))
              .filter((payload) => payload.ref === refInput.ref && typeof payload.value === "string")
              .at(-1);
            return typeof filled?.value === "string" ? filled.value : undefined;
          });
          const target = domHost.findWindow(refInput.windowId);
          if (!target) {
            throw new Error("No window available");
          }
          const scope = await resolveRefScope(domHost, refInput.ref);
          const result = await target.webContents.executeJavaScript(`
            (() => {
              const ref = ${JSON.stringify(refInput.ref)};
              const latestFilledValue = ${JSON.stringify(latestFilledValue)};
              const element = [...document.querySelectorAll("[data-plastic-ref]")]
                .find((candidate) => candidate.dataset.plasticRef === ref);
              if (!element) {
                return { clicked: false, reason: "ref not found" };
              }
              ${domHost.scrollRefIntoViewScript(refInput.ref)}
              if (element instanceof HTMLFormElement) {
                const field = element.querySelector("textarea, input");
                if (field && latestFilledValue !== undefined && field.value.trim().length === 0) {
                  field.value = latestFilledValue;
                  field.dispatchEvent(new Event("input", { bubbles: true }));
                  field.dispatchEvent(new Event("change", { bubbles: true }));
                }
                element.requestSubmit();
              } else {
                element.click();
              }
              return {
                clicked: true,
                ref,
                tag: element.tagName.toLowerCase(),
                submitted: element instanceof HTMLFormElement,
                text: (element.innerText || element.textContent || "").slice(0, 240)
              };
            })()
          `) as unknown;
          const event = await runPromise(
            eventStore.append(
              createEvent({
                type: "deixis.ref.clicked",
                payload: {
                  ref: refInput.ref,
                  windowId: target.id,
                  result
                },
                ...(scope ? { scope } : {})
              })
            )
          );
          return { windowId: target.id, ref: refInput.ref, result, eventId: event.id };
        })
    })
  );
};

const registerFillRef = async (
  context: RuntimeMethodContext,
  host: Partial<DeixisMethodHost>
) => {
  const { eventStore, methods, runPromise } = context;
  await runPromise(
    methods.register({
      id: "deixis/fillRef",
      title: "Fill visible UI reference",
      description: "Fills an input or textarea inside a visible data-plastic-ref and records the action.",
      owner: { kind: "runtime", id: "plastic.runtime" },
      availability: availabilityFromCapabilities(
        context.capabilities,
        ["dom.refs", "dom.input"],
        "Requires a rendered DOM and input control."
      ),
      handler: (input) =>
        Effect.promise(async () => {
          if (!host.findWindow || !host.resolveVisibleRef || !host.panelIdFromRef || !host.scrollRefIntoViewScript) {
            throw new Error("deixis/fillRef is unavailable: missing dom.refs or dom.input capability");
          }
          const domHost = {
            findWindow: host.findWindow,
            resolveVisibleRef: host.resolveVisibleRef,
            panelIdFromRef: host.panelIdFromRef,
            scrollRefIntoViewScript: host.scrollRefIntoViewScript
          };
          const refInput = input as RefInput;
          if (!refInput.ref) {
            throw new Error("deixis/fillRef requires ref");
          }
          if (refInput.value === undefined) {
            throw new Error("deixis/fillRef requires value");
          }
          const target = domHost.findWindow(refInput.windowId);
          if (!target) {
            throw new Error("No window available");
          }
          const scope = await resolveRefScope(domHost, refInput.ref);
          const result = await target.webContents.executeJavaScript(`
            (() => {
              const ref = ${JSON.stringify(refInput.ref)};
              const value = ${JSON.stringify(refInput.value)};
              const root = [...document.querySelectorAll("[data-plastic-ref]")]
                .find((candidate) => candidate.dataset.plasticRef === ref);
              if (!root) {
                return { filled: false, reason: "ref not found" };
              }
              ${domHost.scrollRefIntoViewScript(refInput.ref)}
              const element = root.matches("input, textarea")
                ? root
                : root.querySelector("textarea, input");
              if (!element) {
                return { filled: false, reason: "no input or textarea found" };
              }
              element.focus();
              element.value = value;
              element.dispatchEvent(new Event("input", { bubbles: true }));
              element.dispatchEvent(new Event("change", { bubbles: true }));
              return {
                filled: true,
                ref,
                tag: element.tagName.toLowerCase(),
                length: value.length
              };
            })()
          `) as unknown;
          const event = await runPromise(
            eventStore.append(
              createEvent({
                type: "deixis.ref.filled",
                payload: {
                  ref: refInput.ref,
                  windowId: target.id,
                  valueLength: refInput.value.length,
                  value: refInput.value,
                  result
                },
                ...(scope ? { scope } : {})
              })
            )
          );
          return { windowId: target.id, ref: refInput.ref, result, eventId: event.id };
        })
    })
  );
};

const findRecentEvents = (events: PlasticEvent[], predicate: (event: PlasticEvent) => boolean, limit = 20) =>
  events.filter(predicate).slice(-limit);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const resolveRefScope = async (
  host: Pick<DeixisMethodHost, "resolveVisibleRef" | "panelIdFromRef">,
  ref: string
): Promise<EventScopeInput | undefined> => {
  const visible = await host.resolveVisibleRef(ref).catch(() => null);
  const panelId = visible?.ref.panel ?? host.panelIdFromRef(ref);
  const extensionId = visible?.ref.extension;
  if (!panelId && !extensionId) {
    return undefined;
  }
  return {
    ...(panelId ? { panelId } : {}),
    ...(extensionId ? { extensionId } : {})
  };
};
