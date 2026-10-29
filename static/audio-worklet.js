// Audio worklets for the call page.
//
// capture-processor: (noise-suppressed) mic -> 16 kHz 16-bit mono PCM in 40 ms chunks.
//   Includes an "echo guard": while the assistant is talking, quiet sound (its own voice leaking
//   from the speakers, background noise) is replaced with silence, so it doesn't interrupt itself.
//   Clear, louder speech from the caller still passes, so they can always cut in.
// playback-processor: queues 24 kHz PCM from the server, reports a level for the avatar's mouth,
//   flushes on interruption and reports "done" when the goodbye has finished after a hangup.

const CHUNK = 640; // 40 ms at 16 kHz
const GUARD_THRESHOLD = 0.045; // RMS needed to pass while the assistant is speaking
const GUARD_HOLD_FRAMES = 8; // keep the gate open ~320 ms after speech so word endings aren't cut

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0; // running sum for the low-pass decimator
    this.accN = 0;
    this.phase = 0;
    this.chunk = new Float32Array(CHUNK);
    this.length = 0;
    this.agentSpeaking = false;
    this.hold = 0;
    this.port.onmessage = ({ data }) => {
      if ("agentSpeaking" in data) this.agentSpeaking = data.agentSpeaking;
    };
  }

  process([input]) {
    const samples = input[0];
    if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      // Average each group of `ratio` input samples: a cheap anti-aliasing filter + downsample.
      this.acc += samples[i];
      this.accN += 1;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.chunk[this.length++] = this.acc / this.accN;
        this.acc = 0;
        this.accN = 0;
        this.phase -= this.ratio; // keep the fraction so non-integer ratios (44.1 kHz) stay exact
        if (this.length === CHUNK) this.flush();
      }
    }
    return true;
  }

  flush() {
    let sum = 0;
    for (let i = 0; i < CHUNK; i++) sum += this.chunk[i] * this.chunk[i];
    const level = Math.sqrt(sum / CHUNK);

    let pass = true;
    if (this.agentSpeaking) {
      if (level >= GUARD_THRESHOLD) this.hold = GUARD_HOLD_FRAMES;
      else if (this.hold > 0) this.hold--;
      pass = this.hold > 0;
    } else {
      this.hold = 0;
    }

    const pcm = new Int16Array(CHUNK);
    if (pass) {
      for (let i = 0; i < CHUNK; i++) pcm[i] = Math.max(-1, Math.min(1, this.chunk[i])) * 0x7fff;
    }
    this.port.postMessage({ pcm: pcm.buffer, level: pass ? level : 0 }, [pcm.buffer]);
    this.length = 0;
  }
}

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.hangup = false;
    this.sum = 0;
    this.count = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "flush") {
        this.queue = [];
        this.offset = 0;
      } else if (data === "hangup") {
        this.hangup = true;
      } else {
        this.queue.push(Float32Array.from(new Int16Array(data), (s) => s / 0x8000));
      }
    };
  }

  process(_, [output]) {
    const out = output[0];
    for (let i = 0; i < out.length; i++) {
      const head = this.queue[0];
      if (!head) { out[i] = 0; continue; }
      const s = head[this.offset++];
      out[i] = s;
      this.sum += s * s;
      if (this.offset === head.length) { this.queue.shift(); this.offset = 0; }
    }
    // Report a level ~every 50 ms (and whether audio is still queued) for the avatar and echo guard.
    this.count += out.length;
    if (this.count >= 1200) {
      this.port.postMessage({ level: Math.sqrt(this.sum / this.count), playing: this.queue.length > 0 });
      this.sum = 0;
      this.count = 0;
    }
    if (this.hangup && !this.queue.length) {
      this.hangup = false;
      this.port.postMessage("done");
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
registerProcessor("playback-processor", PlaybackProcessor);
