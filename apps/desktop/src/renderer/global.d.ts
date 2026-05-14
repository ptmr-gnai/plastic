export {};

declare global {
  interface Window {
    plastic: {
      call: (method: string, input?: unknown) => Promise<unknown>;
    };
  }
}

