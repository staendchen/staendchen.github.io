class Grabber extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.n = 0;
    this.done = false;
    this.port.onmessage = e => { if (e.data === "stop") this.done = true; };
  }

  flush() {
    if (this.n) this.port.postMessage(this.buffer.slice(0, this.n));
    this.n = 0;
  }

  process(inputs) {
    if (this.done) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    if (channel.length > this.buffer.length) {
      this.flush();
      this.port.postMessage(channel.slice(0, this.buffer.length));
      return true;
    }
    if (this.n + channel.length > this.buffer.length) this.flush();
    this.buffer.set(channel, this.n);
    this.n += channel.length;
    if (this.n >= 1024) this.flush();
    return true;
  }
}

registerProcessor("staendchen-grabber", Grabber);
