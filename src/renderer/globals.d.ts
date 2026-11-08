/** Globals exposed by src/main/preload.ts through contextBridge. */
export {};

declare global {
  interface Window {
    dontBlink: {
      /** The Presage key, fetched once when the camera starts. */
      getPresageApiKey(): Promise<string>;
      /** Read a bundled head-tracking file (WASM runtime or model). */
      loadAsset(name: 'mediapipe-loader' | 'mediapipe-wasm' | 'face-model' | 'segment-model' | `watcher-${string}`): Promise<Uint8Array>;
      /** Called once when the window is about to close. */
      onClosing(cb: () => void): void;
      /** Tell the main process the camera and SDK are stopped. */
      readyToClose(): void;
      /** Save a recorded round (WebM bytes) through a save dialog. */
      saveVideo(bytes: Uint8Array, ext: 'mp4' | 'webm'): Promise<{ ok: boolean; path?: string; error?: string }>;
      /** Save a PNG data URL through a save dialog. */
      savePng(dataUrl: string): Promise<{ ok: boolean; path?: string; error?: string }>;
    };
  }
}
