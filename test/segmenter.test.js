import { describe, it, expect } from 'vitest';
import { Segmenter } from '../src/lib/segmenter.js';

const SR = 16000;
const silence = (ms) => new Float32Array((SR * ms) / 1000);
const tone = (ms, amp = 0.2) => Float32Array.from({ length: (SR * ms) / 1000 }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / SR));

function feed(seg, ...parts) {
  const out = [];
  // Feed in odd-sized chunks, like the audio worklet does.
  for (const p of parts) for (let i = 0; i < p.length; i += 1000) out.push(...seg.push(p.subarray(i, i + 1000)));
  return out;
}

describe('Segmenter', () => {
  it('emits nothing for silence', () => {
    const s = new Segmenter();
    expect(feed(s, silence(3000))).toEqual([]);
    expect(s.flush()).toBeNull();
  });

  it('cuts an utterance at a pause and keeps pre-roll', () => {
    const s = new Segmenter();
    const segs = feed(s, silence(1000), tone(1500), silence(1000));
    expect(segs).toHaveLength(1);
    const ms = (segs[0].length / SR) * 1000;
    // 1500 ms speech + up to 300 ms pre-roll + up to 300 ms tail.
    expect(ms).toBeGreaterThanOrEqual(1500);
    expect(ms).toBeLessThanOrEqual(2200);
    expect(s.inSpeech).toBe(false);
  });

  it('splits two utterances separated by a pause', () => {
    const s = new Segmenter();
    expect(feed(s, silence(500), tone(800), silence(900), tone(800), silence(900))).toHaveLength(2);
  });

  it('keeps short gaps inside one utterance', () => {
    const s = new Segmenter();
    expect(feed(s, silence(500), tone(800), silence(300), tone(800), silence(900))).toHaveLength(1);
  });

  it('drops clicks shorter than the minimum speech length', () => {
    const s = new Segmenter();
    expect(feed(s, silence(500), tone(60), silence(1000))).toEqual([]);
  });

  it('forces a cut on long speech', () => {
    const s = new Segmenter({ maxSegmentMs: 2000 });
    const segs = feed(s, tone(5000));
    expect(segs.length).toBe(2);
    expect(segs[0].length).toBeLessThanOrEqual(SR * 2);
  });

  it('flushes the utterance in progress on stop', () => {
    const s = new Segmenter();
    feed(s, silence(300), tone(1000));
    expect(s.inSpeech).toBe(true);
    expect(s.current().length).toBeGreaterThan(SR * 0.9);
    expect(s.flush().length).toBeGreaterThan(SR * 0.9);
    expect(s.inSpeech).toBe(false);
  });

  it('adapts to steady background noise', () => {
    const s = new Segmenter();
    const noise = () => Float32Array.from({ length: SR * 2 }, () => (Math.random() - 0.5) * 0.04);
    expect(feed(s, noise(), noise())).toEqual([]);
    expect(feed(s, tone(1000, 0.3), silence(1000))).toHaveLength(1);
  });
});
