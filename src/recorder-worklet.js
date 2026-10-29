// Runs on the audio thread: batches 128-sample render quanta into ~64 ms
// chunks and posts them to the offscreen document.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.len = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) {
      this.buf.set(ch, this.len);
      this.len += ch.length;
      if (this.len >= 1024 - 128) {
        this.port.postMessage(this.buf.slice(0, this.len));
        this.len = 0;
      }
    }
    return true;
  }
}

registerProcessor('recorder', RecorderProcessor);
