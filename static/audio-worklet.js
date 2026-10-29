// Audio worklets for the call page.
//
// capture-processor: mic -> 16 kHz 16-bit mono PCM in 40 ms chunks.
//   Echo guard: while Hamdan is talking (and for a short tail afterwards), his own voice leaking from the
//   speakers must not reach Gemini, or Gemini thinks the caller interrupted and stops mid-sentence.
//   During that time the mic sends silence, unless the caller speaks clearly louder than the echo for
//   at least 120 ms, so callers can still cut in.
// playback-processor: queues 24 kHz PCM from the server, reports a level for the avatar's mouth,
//   flushes on interruption and reports "done" when the goodbye has finished after a hangup.

const CHUNK = 640; // 40 ms at 16 kHz
const TAIL_FRAMES = 12; // keep guarding ~480 ms after Hamdan stops (room echo, gaps between sentences)
const OPEN_FRAMES = 3; // caller must be loud for 120 ms in a row to cut in
const HOLD_FRAMES = 10; // once open, stay open ~400 ms so words aren't chopped
const MIN_BARGE_LEVEL = 0.06; // absolute minimum level to cut in
const ECHO_RATIO = 3; // ... and at least 3x the echo level measured during this call

class CaptureProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions = {} }) {
    super();
    this.guardEnabled = processorOptions.echoGuard !== false;
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.accN = 0;
    this.phase = 0;
    this.chunk = new Float32Array(CHUNK);
    this.length = 0;
    this.agentSpeaking = false;
    this.tail = 0;
    this.echo = 0.01; // running estimate of how loud Hamdan's voice is in the mic
    this.loud = 0;
    this.hold = 0;
    this.port.onmessage = ({ data }) => {
      if ("agentSpeaking" in data) {
        this.agentSpeaking = data.agentSpeaking;
        if (!data.agentSpeaking) this.tail = TAIL_FRAMES;
      }
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
        this.phase -= this.ratio;
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
    const guarding = this.guardEnabled && (this.agentSpeaking || this.tail > 0);
    if (guarding) {
      if (!this.agentSpeaking) this.tail--;
      const bar = Math.max(MIN_BARGE_LEVEL, this.echo * ECHO_RATIO);
      this.loud = level > bar ? this.loud + 1 : 0;
      if (this.loud >= OPEN_FRAMES) this.hold = HOLD_FRAMES;
      else if (this.hold > 0) this.hold--;
      pass = this.hold > 0;
      if (!pass) this.echo = this.echo * 0.97 + level * 0.03; // learn the echo level from guarded frames
    } else {
      this.loud = 0;
      this.hold = 0;
    }

    const pcm = new Int16Array(CHUNK);
    if (pass) {
      for (let i = 0; i < CHUNK; i++) pcm[i] = Math.max(-1, Math.min(1, this.chunk[i])) * 0x7fff;
    }
    this.port.postMessage({ pcm: pcm.buffer, level: pass ? level : 0, raw: level, guarding, pass }, [pcm.buffer]);
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
