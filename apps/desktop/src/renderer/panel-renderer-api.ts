export type PlasticPanel = {
  id: string;
  title: string;
  kind: string;
  extensionId: string;
  rendererId?: string;
  subtitle?: string;
  body?: string;
  order: number;
};

export type ChatButton = {
  id: string;
  label: string;
  action: {
    method: string;
    input?: unknown;
  };
};

export type ChatMessage = {
  id: string;
  content: string;
  role: "user" | "agent" | "system" | "peer";
  streaming?: boolean;
};

export type ChatBinding = {
  chatId: string;
  runtimeId: string;
  threadId: string | null;
  activeTurnId: string | null;
  activeTurnStatus: string | null;
};

export type PanelRendererContext = {
  panel: PlasticPanel;
};

export type PanelRenderer = {
  id: string;
  extensionId: string;
  panelKinds: string[];
  closeMethod: string;
  closeInputKey: string;
  render: (context: PanelRendererContext) => string;
};

export type ChatPanelRendererContext = PanelRendererContext & {
  buttons: ChatButton[];
  messages: ChatMessage[];
  binding?: ChatBinding;
  peer?: PlasticPanel;
  escapeHtml: (value: string) => string;
};
