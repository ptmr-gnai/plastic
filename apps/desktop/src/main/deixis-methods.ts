import type { BrowserWindow as ElectronBrowserWindow } from "electron";
import { Effect } from "effect";
import {
  buildTimeline,
  createEvent,
  eventSummary,
  type EventScopeInput,
  type PlasticEvent,
  type TimelineInput
} from "@plastic/core";
import { deixisAvailability } from "./deixis-availability.js";
import {
  clickRefMetadata,
  evalDomMetadata,
  fillRefMetadata,
  listVisibleRefsMetadata,
  resolveRefMetadata,
  screenshotMetadata,
  verifyRefActionMetadata
} from "./deixis-method-metadata.js";
import { resolveDeixisRef } from "./deixis-resolve-ref.js";
import type { RefInput, ScreenshotInput, VerifyRefActionInput } from "./deixis-types.js";
import type { RuntimeMethodContext, RuntimeModule } from "./runtime-method-context.js";

export type ResolvedVisibleRef = {
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

export type DeixisMethodHost = {
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
      availability: deixisAvailability(context.capabilities, "deixis/listVisibleRefs"),
      ...listVisibleRefsMetadata,
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
      availability: deixisAvailability(context.capabilities, "windows/screenshot"),
      ...screenshotMetadata,
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
      availability: deixisAvailability(context.capabilities, "deixis/resolveRef"),
      ...resolveRefMetadata,
      handler: (input) =>
        Effect.promise(async () => {
          if (!host.resolveVisibleRef || !host.panelIdFromRef || !host.sourceHintsFor) {
            throw new Error("deixis/resolveRef is unavailable: missing dom.refs capability");
          }
          const resolverHost = {
            panelIdFromRef: host.panelIdFromRef,
            resolveVisibleRef: host.resolveVisibleRef,
            sourceHintsFor: host.sourceHintsFor
          };
          const ref = (input as { ref?: string }).ref;
          if (!ref) {
            throw new Error("deixis/resolveRef requires ref");
          }

          const events = await runPromise(eventStore.list());
          return resolveDeixisRef({ ref, events, host: resolverHost, methods, runPromise });
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
      availability: deixisAvailability(context.capabilities, "deixis/evalDom"),
      ...evalDomMetadata,
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
      availability: deixisAvailability(context.capabilities, "deixis/verifyRefAction"),
      ...verifyRefActionMetadata,
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
      availability: deixisAvailability(context.capabilities, "deixis/clickRef"),
      ...clickRefMetadata,
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
      availability: deixisAvailability(context.capabilities, "deixis/fillRef"),
      ...fillRefMetadata,
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
