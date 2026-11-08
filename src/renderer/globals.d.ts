/** Globals exposed by src/main/preload.ts through contextBridge. */
export {};

declare global {
  interface Window {
    dontBlink: {
      /** The Presage key, fetched once when the camera starts. */
      getPresageApiKey(): Promise<string>;
      /** Save a PNG data URL through a save dialog. */
      savePng(dataUrl: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    };
  }
}
