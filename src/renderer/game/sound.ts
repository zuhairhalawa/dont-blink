/**
 * src/renderer/game/sound.ts
 *
 * All game audio is synthesised with the Web Audio API; there are no audio
 * files. Levels stay moderate: the scare comes from timing, not volume.
 *
 *   - Room tone: a low mains hum from the bare bulb.
 *   - Heartbeat: a "lub-dub" at the player's live pulse rate (from Presage),
 *     louder as the Watcher gets closer.
 *   - Dread drone: rises with the Watcher's distance.
 *   - Move cue: a dull thud each time the Watcher moves during a blink.
 *   - Shriek: the jump scare when you are caught.
 *   - Release: a soft falling tone when you survive.
 */

export class GameAudio {
  private readonly ctx = new AudioContext();
  private readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private droneGain: GainNode | null = null;
  private heartGain: GainNode;
  private heartTimer: number | null = null;
  private bpm: number | null = null;
  private dread = 0;

  constructor() {
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.heartGain = this.ctx.createGain();
    this.heartGain.gain.value = 0.5;
    this.heartGain.connect(this.master);
    this.noise = this.makeNoise(2);
  }

  /** Start the room tone and the dread drone. Call from a user gesture. */
  start(): void {
    void this.ctx.resume();
    const t = this.ctx.currentTime;

    // Bulb hum: 50 Hz plus its harmonics, very quiet.
    const hum = this.ctx.createGain();
    hum.gain.value = 0.035;
    for (const [f, a] of [[50, 1], [100, 0.5], [150, 0.25]] as const) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(hum);
      o.start(t);
    }
    hum.connect(this.master);

    // Dread drone: detuned low saws through a low-pass, silent until the
    // Watcher moves.
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    for (const f of [41.2, 41.6, 61.7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
    }
    lp.connect(g).connect(this.master);
    this.droneGain = g;
  }

  /** Live pulse in bpm, or null while it is not known yet. */
  setPulse(bpm: number | null): void {
    const was = this.bpm;
    this.bpm = bpm;
    if (bpm !== null && was === null) this.scheduleBeat();
  }

  /** How close the Watcher is, 0 (far end) to 1 (at your face). */
  setDread(d: number): void {
    this.dread = Math.max(0, Math.min(1, d));
    const now = this.ctx.currentTime;
    this.droneGain?.gain.setTargetAtTime(0.02 + this.dread * 0.28, now, 0.25);
    this.heartGain.gain.setTargetAtTime(0.25 + this.dread * 0.75, now, 0.25);
  }

  /** The Watcher moved while your eyes were closed. */
  moved(): void {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.55);
    this.noiseBurst(t, 0.12, 700, 0.35);
  }

  /** The Watcher backed off: a short electrical crackle as the bulb dips. */
  retreated(): void {
    this.noiseBurst(this.ctx.currentTime, 0.18, 3200, 0.18);
  }

  /** Jump scare. */
  shriek(): void {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 450;
    for (const f of [698, 740, 1046, 1109]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.92, t + 2);
      o.connect(g);
      o.start(t);
      o.stop(t + 2.1);
    }
    g.connect(hp).connect(this.master);
    this.noiseBurst(t, 0.4, 2600, 0.6);
    this.droneGain?.gain.setTargetAtTime(0, t + 0.3, 0.4);
  }

  /** You survived: the drone falls away under a soft descending tone. */
  release(): void {
    const t = this.ctx.currentTime;
    this.droneGain?.gain.setTargetAtTime(0, t, 0.8);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(392, t);
    o.frequency.exponentialRampToValueAtTime(196, t + 2.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 3.1);
  }

  async close(): Promise<void> {
    if (this.heartTimer !== null) clearTimeout(this.heartTimer);
    this.heartTimer = null;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    await new Promise((r) => setTimeout(r, 200));
    await this.ctx.close().catch(() => undefined);
  }

  // ---------------------------------------------------------------------------

  private scheduleBeat(): void {
    if (this.bpm === null || this.ctx.state === 'closed') return;
    this.thump(0, 1);
    this.thump(0.16, 0.6);
    const interval = 60_000 / Math.max(40, Math.min(180, this.bpm));
    this.heartTimer = window.setTimeout(() => this.scheduleBeat(), interval);
  }

  private thump(delay: number, level: number): void {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.heartGain);
    o.start(t);
    o.stop(t + 0.2);
  }

  private noiseBurst(t: number, seconds: number, freq: number, level: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + seconds + 0.05);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
