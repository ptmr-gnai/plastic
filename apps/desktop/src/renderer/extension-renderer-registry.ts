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

const extensionRendererFactories = new Map<string, ExtensionRendererFactory>([
  [
    "plastic.chat.chat-panel",
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

export const createExtensionRenderer = (
  rendererId: string,
  hostContext: ExtensionRendererHostContext
): PanelRenderer | undefined => extensionRendererFactories.get(rendererId)?.(hostContext);

export const knownExtensionRendererIds = () => [...extensionRendererFactories.keys()];
