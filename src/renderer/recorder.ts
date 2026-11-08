/**
 * src/renderer/recorder.ts
 *
 * Records a round from the game's own drawing, with the game's sound, so the
 * player doesn't need a screen recorder. (Play-tests: Windows Snipping Tool
 * froze on this GPU-drawn window, Win+Alt+R wasn't available, and capturing
 * the window through the desktop capturer failed to start.)
 *
 * The round loop copies each drawn frame, plus the HUD, onto `canvas`; this
 * class turns that canvas and the audio into an MP4 (or WebM) file.
 */

export class RoundRecorder {
  /** Frames to record are drawn here by the round loop. */
  readonly canvas: HTMLCanvasElement;
  private readonly chunks: Blob[] = [];
  private readonly rec: MediaRecorder;
  private readonly tracks: MediaStreamTrack[];

  constructor(width: number, height: number, audio: MediaStream | null) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const video = this.canvas.captureStream(30);
    this.tracks = [...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])];
    // MP4 (H.264) first: Chromium can encode it on the graphics card, which
    // leaves the CPU to the Presage SDK; WebM as a fallback.
    const type = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((t) => MediaRecorder.isTypeSupported(t));
    this.rec = new MediaRecorder(new MediaStream(this.tracks), {
      ...(type ? { mimeType: type } : {}),
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 128_000,
    });
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start(1000);
  }

  /** File extension for the recorded format. */
  get ext(): 'mp4' | 'webm' {
    return this.rec.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  }

  /** Stop and return the video. */
  async stop(): Promise<Blob> {
    if (this.rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        this.rec.onstop = () => resolve();
        this.rec.stop();
      });
    }
    for (const t of this.tracks) t.stop();
    return new Blob(this.chunks, { type: this.rec.mimeType || 'video/webm' });
  }
}

/** What the HUD shows, drawn into the recording. */
export interface HudState {
  secondsLeft: number;
  bpm: number | null;
  showPulse: boolean;
  eyesClosed: boolean;
  blinks: number;
  stare: number;
  message: string;
}

const FONT = '"Bahnschrift", "Arial Narrow", sans-serif';

/** Copy a game frame onto the recording canvas and draw the HUD over it. */
export function drawRecordingFrame(out: HTMLCanvasElement, game: HTMLCanvasElement, hud: HudState): void {
  const g = out.getContext('2d')!;
  const w = out.width;
  const h = out.height;
  g.drawImage(game, 0, 0, w, h);
  const u = h / 720; // scale relative to 720p
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 6 * u;
  g.fillStyle = '#E9E2D3';
  g.textBaseline = 'top';
  // Seconds left, top left.
  g.font = `600 ${52 * u}px ${FONT}`;
  g.fillText(String(hud.secondsLeft), 26 * u, 18 * u);
  // Pulse, top right.
  g.textAlign = 'right';
  if (hud.showPulse) {
    g.font = `600 ${32 * u}px ${FONT}`;
    g.fillText(`${hud.bpm ?? '–'} bpm`, w - 26 * u, 22 * u);
  }
  // Eyes, under the pulse.
  g.font = `600 ${16 * u}px ${FONT}`;
  g.fillStyle = hud.eyesClosed ? '#B3122E' : '#E9E2D3';
  g.fillText(hud.eyesClosed ? 'eyes closed' : 'eyes open', w - 26 * u, 66 * u);
  // Message, centred.
  if (hud.message) {
    g.textAlign = 'center';
    g.fillStyle = '#E9E2D3';
    g.font = `600 ${28 * u}px ${FONT}`;
    g.fillText(hud.message, w / 2, h * 0.4);
  }
  // Blink tally and stare bar, bottom.
  g.textAlign = 'left';
  g.fillStyle = '#B3122E';
  g.font = `700 ${26 * u}px ${FONT}`;
  g.fillText('|'.repeat(hud.blinks), 26 * u, h - 46 * u);
  g.shadowBlur = 0;
  const x0 = 200 * u;
  const bw = w - x0 - 26 * u;
  g.fillStyle = 'rgba(233,226,211,0.15)';
  g.fillRect(x0, h - 30 * u, bw, 3 * u);
  g.fillStyle = '#E8B04A';
  g.fillRect(x0, h - 30 * u, bw * hud.stare, 3 * u);
  g.restore();
}
