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

type ExtensionRendererModule = {
  renderer: PanelRenderer;
};

const bundledRendererModules = import.meta.glob<ExtensionRendererModule>(
  "../../extensions/bundled/**/renderer.ts",
  { eager: true }
);

const toWorkspacePath = (modulePath: string) =>
  modulePath.replace(/^\.\.\/\.\.\//, "apps/desktop/");

const wrapRenderer = (renderer: PanelRenderer, hostContext: ExtensionRendererHostContext): PanelRenderer => {
  if (renderer.id !== "plastic.chat.chat-panel") {
    return renderer;
  }

  return {
    ...renderer,
    render: ({ panel }) => {
      const chatContext = hostContext.chat?.(panel);
      return renderer.render({
        panel,
        buttons: chatContext?.buttons ?? [],
        messages: chatContext?.messages ?? [],
        binding: chatContext?.binding,
        peer: chatContext?.peer,
        escapeHtml: chatContext?.escapeHtml ?? ((value) => value)
      } as ChatPanelRendererContext);
    }
  };
};

const bundledRendererFactoriesByModule = new Map<string, ExtensionRendererFactory>(
  Object.entries(bundledRendererModules)
    .filter((entry): entry is [string, ExtensionRendererModule] => Boolean(entry[1]?.renderer))
    .map(([modulePath, module]) => [
      toWorkspacePath(modulePath),
      (hostContext: ExtensionRendererHostContext) => wrapRenderer(module.renderer, hostContext)
    ])
);

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
