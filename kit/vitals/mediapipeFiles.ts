/**
 * kit/vitals/mediapipeFiles.ts
 *
 * One shared set of MediaPipe WASM files for every vision task (head tracking
 * and person segmentation). The bytes come from the caller's loadAsset, so a
 * sandboxed file:// page can use them as blob: URLs.
 */

/** Paths FaceLandmarker / ImageSegmenter accept as their WASM fileset. */
export interface WasmFileset { wasmLoaderPath: string; wasmBinaryPath: string }

export type AssetName = 'mediapipe-loader' | 'mediapipe-wasm' | 'face-model' | 'segment-model';
export type LoadAsset = (name: AssetName) => Promise<Uint8Array>;

let fileset: Promise<WasmFileset> | null = null;

function blobUrl(bytes: Uint8Array, type: string): string {
  return URL.createObjectURL(new Blob([bytes], { type }));
}

/** The WASM loader and binary, loaded once and reused. */
export function visionFileset(loadAsset: LoadAsset): Promise<WasmFileset> {
  if (!fileset) {
    fileset = Promise.all([loadAsset('mediapipe-loader'), loadAsset('mediapipe-wasm')]).then(([js, wasm]) => ({
      wasmLoaderPath: blobUrl(js, 'text/javascript'),
      wasmBinaryPath: blobUrl(wasm, 'application/wasm'),
    }));
    fileset.catch(() => {
      fileset = null;
    });
  }
  return fileset;
}
