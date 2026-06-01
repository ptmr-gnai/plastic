import { renderer as bundledChatRenderer } from "../../extensions/bundled/plastic.chat/renderer.js";
import type {
  ChatBinding,
  ChatButton,
  ChatMessage,
  ChatPanelRendererContext,
  PanelRenderer,
  PanelRendererContext,
  PlasticPanel
} from "./panel-renderer-api.js";

type ChatRendererHostContext = {
  buttons: ChatButton[];
  messages: ChatMessage[];
  binding: ChatBinding | undefined;
  peer: PlasticPanel | undefined;
  escapeHtml: (value: string) => string;
};

export type ExtensionRendererHostContext = {
  chat?: (panel: PanelRendererContext["panel"]) => ChatRendererHostContext;
};

export type ExtensionRendererFactory = (hostContext: ExtensionRendererHostContext) => PanelRenderer;

export type ExtensionRendererContribution = {
  id: string;
  module?: string;
};

const bundledRendererFactoriesByModule = new Map<string, ExtensionRendererFactory>([
  [
    "apps/desktop/extensions/bundled/plastic.chat/renderer.ts",
    (hostContext) => ({
      ...bundledChatRenderer,
      render: ({ panel }) => {
        const chatContext = hostContext.chat?.(panel);
        return bundledChatRenderer.render({
          panel,
          buttons: chatContext?.buttons ?? [],
          messages: chatContext?.messages ?? [],
          binding: chatContext?.binding,
          peer: chatContext?.peer,
          escapeHtml: chatContext?.escapeHtml ?? ((value) => value)
        } as ChatPanelRendererContext);
      }
    })
  ]
]);

const normalizeModulePath = (extensionPath: string | undefined, modulePath: string | undefined) => {
  if (!extensionPath || !modulePath) {
    return null;
  }
  return `${extensionPath.replace(/\/+$/, "")}/${modulePath.replace(/^\/+/, "")}`;
};

export const createExtensionRendererFromContribution = (
  extensionPath: string | undefined,
  contribution: ExtensionRendererContribution,
  hostContext: ExtensionRendererHostContext
): PanelRenderer | undefined => {
  const modulePath = normalizeModulePath(extensionPath, contribution.module);
  if (!modulePath) {
    return undefined;
  }
  const renderer = bundledRendererFactoriesByModule.get(modulePath)?.(hostContext);
  if (!renderer) {
    return undefined;
  }
  return {
    ...renderer,
    id: contribution.id
  };
};

export const knownBundledRendererModulePaths = () => [...bundledRendererFactoriesByModule.keys()];
