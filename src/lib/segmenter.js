// Splits a live 16 kHz mono stream into utterances at pauses, using frame
// energy against an adaptive noise floor. Each finished utterance is
// transcribed and inserted on its own, so text appears while you talk.

const DEFAULTS = {
  sampleRate: 16000,
  frameMs: 30,
  silenceMs: 700, // pause length that ends an utterance
  preRollMs: 300, // audio kept from before speech starts
  maxSegmentMs: 20000, // force a cut so long monologues still stream
  minSpeechMs: 200, // utterances with less voiced audio are dropped
  minThreshold: 0.008, // RMS floor so a silent room isn't "speech"
  noiseRatio: 2.5, // speech must be this many times the noise floor
};

export class Segmenter {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.frameLen = Math.round((this.o.sampleRate * this.o.frameMs) / 1000);
    this.preRollFrames = Math.ceil(this.o.preRollMs / this.o.frameMs);
    this.silenceFrames = Math.ceil(this.o.silenceMs / this.o.frameMs);
    this.maxFrames = Math.floor(this.o.maxSegmentMs / this.o.frameMs);
    this.minSpeechFrames = Math.ceil(this.o.minSpeechMs / this.o.frameMs);
    this.noise = this.o.minThreshold / this.o.noiseRatio;
    this.pending = new Float32Array(0);
    this.preRoll = [];
    this.segment = null; // { frames: Float32Array[], voiced, trailingSilence }
  }

  get inSpeech() {
    return this.segment !== null;
  }

  /** Audio of the utterance in progress, for interim transcripts. */
  current() {
    return this.segment ? concat(this.segment.frames) : null;
  }

  /** Feed samples; returns any utterances completed by them. */
  push(samples) {
    const out = [];
    let buf = this.pending.length ? concat([this.pending, samples]) : samples;
    let i = 0;
    for (; i + this.frameLen <= buf.length; i += this.frameLen) {
      const seg = this.#frame(buf.slice(i, i + this.frameLen));
      if (seg) out.push(seg);
    }
    this.pending = buf.slice(i);
    return out;
  }

  /** End of stream: returns the utterance in progress, if it has speech. */
  flush() {
    const seg = this.segment;
    this.segment = null;
    this.pending = new Float32Array(0);
    this.preRoll = [];
    return seg && seg.voiced >= this.minSpeechFrames ? concat(seg.frames) : null;
  }

  #frame(frame) {
    const level = rms(frame);
    const threshold = Math.max(this.o.minThreshold, this.noise * this.o.noiseRatio);
    const speech = level > threshold;

    if (!this.segment) {
      if (!speech) {
        // Track the noise floor only while nobody is talking.
        this.noise = this.noise * 0.95 + level * 0.05;
        this.preRoll.push(frame);
        if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
        return null;
      }
      this.segment = { frames: [...this.preRoll, frame], voiced: 1, trailingSilence: 0 };
      this.preRoll = [];
      return null;
    }

    const seg = this.segment;
    seg.frames.push(frame);
    if (speech) {
      seg.voiced++;
      seg.trailingSilence = 0;
    } else {
      seg.trailingSilence++;
    }

    if (seg.trailingSilence >= this.silenceFrames || seg.frames.length >= this.maxFrames) {
      this.segment = null;
      if (seg.voiced < this.minSpeechFrames) return null;
      // Trim most of the trailing silence; keep a little so words aren't clipped.
      const keep = seg.frames.length - Math.max(0, seg.trailingSilence - this.preRollFrames);
      return concat(seg.frames.slice(0, keep));
    }
    return null;
  }
}

export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export function concat(arrays) {
  let n = 0;
  for (const a of arrays) n += a.length;
  const out = new Float32Array(n);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
