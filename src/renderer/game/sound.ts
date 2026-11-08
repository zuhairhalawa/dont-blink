/**
 * apps/scare-meter/scene/sound.ts
 *
 * Every sound in the scene is synthesised with the Web Audio API: rain, a
 * door creak, knocks, a low drone, a shriek and a door slam. There are no
 * audio files, so the kit ships without third-party assets.
 *
 * Levels are kept moderate. The loudest moment (the shriek) peaks well below
 * full scale, so the scare comes from timing rather than volume.
 */

import type { CueKind } from './beats';

export class SceneAudio {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private rainGain: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneOscs: OscillatorNode[] = [];
  private droneBase = 0;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise(2);
  }

  /** Start the background rain. Call once when the scene starts. */
  start(): void {
    void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 0.4;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 3);
    src.connect(band).connect(g).connect(this.master);
    src.start();
    this.rainGain = g;
  }

  /** Fire a one-shot cue. */
  play(kind: CueKind): void {
    switch (kind) {
      case 'creak':   this.creak(); break;
      case 'knock':   this.knock(); break;
      case 'drone':   this.startDrone(); break;
      case 'droneOff': this.stopDrone(0.1); break;
      case 'shriek':  this.shriek(); break;
      case 'flicker': this.buzz(); break;
      case 'slam':    this.slam(); break;
    }
  }

  /**
   * Live tension (0-1) from the player's pulse: the drone gets louder and the
   * rain quieter as tension rises.
   */
  setTension(t: number): void {
    const now = this.ctx.currentTime;
    if (this.droneGain) {
      this.droneGain.gain.setTargetAtTime(this.droneBase * (0.5 + t), now, 0.4);
    }
    if (this.rainGain) {
      this.rainGain.gain.setTargetAtTime(0.18 * (1 - 0.6 * t), now, 0.6);
    }
  }

  /** Fade the rain out (used for the long silence). */
  silenceRain(): void {
    this.rainGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
  }

  /** Stop everything within about 200 ms and release the audio device. */
  async close(): Promise<void> {
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0, now, 0.05);
    await new Promise((r) => setTimeout(r, 200));
    await this.ctx.close().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Sounds
  // -------------------------------------------------------------------------

  /** A slow wooden creak: a buzzy tone sliding in pitch through a resonant filter. */
  private creak(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.linearRampToValueAtTime(110, t + 0.6);
    osc.frequency.linearRampToValueAtTime(85, t + 1.4);
    // Tremolo gives the stick-slip texture of a hinge.
    const trem = this.ctx.createOscillator();
    trem.frequency.value = 23;
    const tremGain = this.ctx.createGain();
    tremGain.gain.value = 0.5;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 900;
    filt.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.15);
    g.gain.linearRampToValueAtTime(0.35, t + 1.1);
    g.gain.linearRampToValueAtTime(0, t + 1.6);
    trem.connect(tremGain).connect(g.gain);
    osc.connect(filt).connect(g).connect(this.master);
    osc.start(t); trem.start(t);
    osc.stop(t + 1.7); trem.stop(t + 1.7);
  }

  /** One knock on wood: a short low thump plus a click of noise. */
  private knock(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.3);
    this.noiseBurst(t, 0.04, 2500, 0.5);
  }

  /** A low, beating drone that sits under the shadow beat. */
  private startDrone(): void {
    if (this.droneOscs.length > 0) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    this.droneBase = 0.22;
    g.gain.linearRampToValueAtTime(this.droneBase * 0.5, t + 6);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    for (const f of [55, 55.7, 82.4]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      this.droneOscs.push(o);
    }
    lp.connect(g).connect(this.master);
    this.droneGain = g;
  }

  private stopDrone(fadeSeconds: number): void {
    if (!this.droneGain) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(0, t, fadeSeconds);
    for (const o of this.droneOscs) o.stop(t + fadeSeconds * 6);
    this.droneOscs = [];
    this.droneGain = null;
  }

  /** The jump scare: a harsh dissonant stab with a noise hit. */
  private shriek(): void {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    for (const f of [740, 784, 1046, 1108]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.94, t + 1.8);
      o.connect(g);
      o.start(t); o.stop(t + 1.9);
    }
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    g.connect(hp).connect(this.master);
    this.noiseBurst(t, 0.35, 3000, 0.7);
  }

  /** Electrical buzz while the lights flicker. */
  private buzz(): void {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.3);
    g.gain.setValueAtTime(0.05, t + 3.6);
    g.gain.linearRampToValueAtTime(0, t + 4);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 4.1);
  }

  /** The door slamming shut: a deep boom and a crack. */
  private slam(): void {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 1.3);
    this.noiseBurst(t, 0.15, 1200, 0.9);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

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
