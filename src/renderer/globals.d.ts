/** Globals exposed by src/main/preload.ts through contextBridge. */
export {};

declare global {
  interface Window {
    dontBlink: {
      /** The Presage key, fetched once when the camera starts. */
      getPresageApiKey(): Promise<string>;
      /** Read a bundled head-tracking file (WASM runtime or model). */
      loadAsset(name: 'mediapipe-loader' | 'mediapipe-wasm' | 'face-model' | 'segment-model'): Promise<Uint8Array>;
      /** Save a PNG data URL through a save dialog. */
      savePng(dataUrl: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    };
  }
}
