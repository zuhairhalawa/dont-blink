/**
 * src/main/preload.ts
 *
 * Bundled by esbuild (sandboxed preloads cannot require npm packages), so the
 * SmartSpectra preload is included in this file.
 */

require('@smartspectra/node-sdk/preload');

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('dontBlink', {
  getPresageApiKey(): Promise<string> {
    return ipcRenderer.invoke('get-presage-api-key') as Promise<string>;
  },
  savePng(dataUrl: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    return ipcRenderer.invoke('save-png', dataUrl) as Promise<{ ok: boolean; path?: string; error?: string }>;
  },
});
