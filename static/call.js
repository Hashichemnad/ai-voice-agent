// The call page. Runs inside the website's iframe (embed=1) or on its own (direct link).
// Flow: tap the character -> ringing -> server says "ready" -> the assistant greets the caller.

const params = new URLSearchParams(location.search);
const LANG = params.get("lang") === "ar" ? "ar" : "en";
const EMBED = params.get("embed") === "1" && window.parent !== window;
// Audio options, for testing on different devices (the widget passes these through):
//   nf=on            extra neural noise filter (RNNoise) on top of the browser's own noise suppression
//   echoguard=off    let all mic audio through while Hamdan talks (only sensible with headphones)
//   debug=1          show live audio diagnostics under the status line
const NOISE_FILTER = params.get("nf") === "on";
const ECHO_GUARD = params.get("echoguard") !== "off";
const DEBUG = params.get("debug") === "1";
const RING_MIN_MS = 2200; // let at least one ring play so the call feels like a call
const CONNECT_TIMEOUT_MS = 30000;

const TEXT = {
  en: {
    org: "Ajman Department of Finance", role: "Virtual assistant", name: "Hamdan",
    minimize: "Minimise", start: "Call Hamdan", close: "Close", end: "End call", mute: "Mute microphone",
    type: "Type instead", send: "Send", typePlaceholder: "Type your question…",
    intro: "Ask about our services, fees, Tawreed, Ajman Sadad or working hours, in Arabic or English.",
    privacy: "AI assistant. Never share your Emirates ID, passwords or card details.",
    calling: "Calling", allowMic: "Allow microphone access when your browser asks.",
    listening: "Listening", speaking: "Speaking", checking: "Checking", muted: "Microphone off",
    captionsEmpty: "Hamdan's words will appear here.",
    ended: (t) => `Call ended · ${t}. Thank you for contacting the Ajman Department of Finance.`,
    again: "Call again", tryAgain: "Try again",
    micError: "Hamdan can't hear you because microphone access is blocked. Allow the microphone in your browser's site settings, then try again.",
    busy: "All lines are busy right now. Please try again in a minute, or call 80070.",
    serviceError: "Hamdan isn't available right now. Please try again shortly, or call 80070.",
    netError: "The call dropped. Check your internet connection and call again.",
    noSupport: "This browser can't make voice calls. Please use a recent version of Chrome, Edge, Safari or Firefox.",
  },
  ar: {
    org: "دائرة المالية - حكومة عجمان", role: "المساعد الافتراضي", name: "حمدان",
    minimize: "تصغير", start: "اتصل بحمدان", close: "إغلاق", end: "إنهاء المكالمة", mute: "كتم الميكروفون",
    type: "الكتابة بدلاً من الكلام", send: "إرسال", typePlaceholder: "اكتب سؤالك…",
    intro: "اسأل عن خدماتنا ورسومها ومنصة توريد ومحفظة سداد عجمان وساعات العمل، بالعربية أو الإنجليزية.",
    privacy: "مساعد ذكاء اصطناعي. لا تشارك رقم الهوية أو كلمات المرور أو بيانات البطاقة.",
    calling: "جارٍ الاتصال", allowMic: "اسمح باستخدام الميكروفون عندما يطلب المتصفح ذلك.",
    listening: "يستمع إليك", speaking: "يتحدث", checking: "يبحث عن المعلومة", muted: "الميكروفون مغلق",
    captionsEmpty: "سيظهر كلام حمدان هنا.",
    ended: (t) => `انتهت المكالمة · ${t}. شكراً لتواصلك مع دائرة المالية بعجمان.`,
    again: "اتصل مرة أخرى", tryAgain: "حاول مرة أخرى",
    micError: "لا يستطيع حمدان سماعك لأن الميكروفون محظور. اسمح بالميكروفون من إعدادات الموقع في المتصفح ثم حاول مرة أخرى.",
    busy: "جميع الخطوط مشغولة حالياً. يرجى المحاولة بعد دقيقة أو الاتصال على 80070.",
    serviceError: "حمدان غير متاح حالياً. يرجى المحاولة لاحقاً أو الاتصال على 80070.",
    netError: "انقطعت المكالمة. تحقق من اتصالك بالإنترنت ثم اتصل مرة أخرى.",
    noSupport: "هذا المتصفح لا يدعم المكالمات الصوتية. يرجى استخدام أحدث إصدار من كروم أو إيدج أو سفاري أو فايرفوكس.",
  },
}[LANG];

const $ = (id) => document.getElementById(id);
const body = document.body;
let call = null; // everything belonging to the current call
let panelOpen = false;

// ---------- Setup ----------

document.documentElement.lang = LANG;
document.documentElement.dir = LANG === "ar" ? "rtl" : "ltr";
if (params.get("pos") === "left") body.classList.add("pos-left");
document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = TEXT[el.dataset.t]));
document.querySelectorAll("[data-t-label]").forEach((el) => {
  el.setAttribute("aria-label", TEXT[el.dataset.tLabel]);
  el.title = TEXT[el.dataset.tLabel];
});
document.querySelectorAll("[data-t-placeholder]").forEach((el) => (el.placeholder = TEXT[el.dataset.tPlaceholder]));
$("captions").dataset.empty = TEXT.captionsEmpty;
$("launcher").setAttribute("aria-label", TEXT.start);

// The same character in the launcher and on the stage (ids made unique per copy).
fetch("hamdan.svg").then((r) => r.text()).then((svg) => {
  document.querySelectorAll("[data-avatar]").forEach((el, i) => {
    el.innerHTML = svg.replaceAll('id="h-', `id="h${i}-`).replaceAll("url(#h-", `url(#h${i}-`);
  });
});

if (EMBED) {
  setState("idle");
  window.addEventListener("resize", () => body.classList.toggle("full", innerWidth < 480));
  body.classList.toggle("full", innerWidth < 480);
} else {
  body.classList.add("standalone");
  $("launcher").hidden = true;
  $("minimize").hidden = true;
  setState("ready");
  showPanel(true);
}

// ---------- UI wiring ----------

$("launcher").onclick = () => (call ? showPanel(true) : startCall());
$("start").onclick = startCall;
$("again").onclick = startCall;
$("end").onclick = () => endCall("user");
$("minimize").onclick = () => minimize();
$("close").onclick = () => (EMBED ? minimize() : setState("ready"));
$("mute").onclick = toggleMute;
$("keyboard").onclick = toggleKeyboard;
$("text-form").onsubmit = sendText;
// The host page can open the panel (greeting bubble or its own "Talk to us" button).
window.addEventListener("message", (e) => {
  if (e.source !== parent || e.data?.source !== "dof-voice-host" || e.data.action !== "open") return;
  if (!call && body.dataset.state !== "ended" && body.dataset.state !== "error") setState("ready");
  showPanel(true);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panelOpen && EMBED) minimize(); });

function setState(state) {
  body.dataset.state = state;
}

function showPanel(open) {
  panelOpen = open;
  $("panel").hidden = !open;
  $("launcher").hidden = open || !EMBED;
  if (EMBED) parent.postMessage({ source: "dof-voice", open }, "*");
  if (open) setTimeout(() => (body.dataset.state === "ready" ? $("start") : $("minimize")).focus({ preventScroll: true }), 50);
}

function minimize() {
  showPanel(false);
  if (!call) setState("idle");
  $("launcher").focus({ preventScroll: true });
}

function setStatus(text, hint = "") {
  $("status").textContent = text;
  $("hint").textContent = hint;
}

// ---------- Call lifecycle ----------

async function startCall() {
  if (call) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) return showError(TEXT.noSupport, false);

  // Audio contexts must be created inside the tap, or browsers keep them silent.
  const c = (call = {
    captureCtx: new AudioContext({ sampleRate: 48000 }),
    playCtx: new AudioContext({ sampleRate: 24000 }),
    pending: [], live: false, muted: false, toolsRunning: 0, agentLevel: 0, agentPlaying: false,
    ringStarted: performance.now(),
  });
  c.ring = startRingback(c.playCtx);

  body.classList.add("in-call");
  setState("calling");
  setStatus(TEXT.calling, TEXT.allowMic);
  $("timer").textContent = "";
  $("captions").replaceChildren();
  $("mute").setAttribute("aria-pressed", "false");
  showPanel(true);

  try {
    c.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    return failCall(TEXT.micError);
  }
  if (call !== c) return; // hung up while the browser was asking

  try {
    await setupAudio(c);
  } catch (err) {
    console.error(err);
    return failCall(TEXT.noSupport);
  }
  if (call !== c) return;
  setStatus(TEXT.calling);
  connect(c);
}

async function setupAudio(c) {
  const { captureCtx, playCtx, stream } = c;
  await Promise.all([captureCtx.audioWorklet.addModule("audio-worklet.js"), playCtx.audioWorklet.addModule("audio-worklet.js")]);

  // Mic -> RNNoise (removes steady and background noise) -> 16 kHz capture with echo guard.
  const source = captureCtx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(captureCtx, "capture-processor", { processorOptions: { echoGuard: ECHO_GUARD } });
  c.capture = capture;
  const denoiser = NOISE_FILTER ? await createDenoiser(captureCtx) : null;
  body.dataset.denoise = denoiser ? "on" : "off"; // handy when troubleshooting a caller's setup
  if (denoiser) {
    source.connect(denoiser).connect(capture);
    c.denoiser = denoiser;
  } else {
    source.connect(capture);
  }
  capture.port.onmessage = ({ data }) => {
    if (c.live && !c.muted && c.ws?.readyState === WebSocket.OPEN) c.ws.send(data.pcm);
    c.userLevel = c.muted ? 0 : data.level;
    if (DEBUG) debugLine(c, data);
  };

  c.player = new AudioWorkletNode(playCtx, "playback-processor");
  c.player.connect(playCtx.destination);
  c.player.port.onmessage = ({ data }) => {
    if (data === "done") return endCall("agent"); // the goodbye has finished playing
    c.agentLevel = data.level;
    if (data.playing !== c.agentPlaying) {
      setAgentPlaying(c, data.playing);
      updateLiveStatus();
    }
  };
  animate(c);
}

// RNNoise needs a 48 kHz context. If anything fails, the call continues with the browser's own suppression.
async function createDenoiser(ctx) {
  if (ctx.sampleRate !== 48000) return null;
  try {
    const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    const [wasmBinary] = await Promise.all([
      fetch(`vendor/rnnoise/${simd ? "rnnoise_simd" : "rnnoise"}.wasm`).then((r) => r.arrayBuffer()),
      ctx.audioWorklet.addModule("vendor/rnnoise/rnnoise-worklet.js"),
    ]);
    return new AudioWorkletNode(ctx, "@sapphi-red/web-noise-suppressor/rnnoise", { processorOptions: { maxChannels: 1, wasmBinary } });
  } catch (err) {
    console.warn("Noise suppression unavailable:", err);
    return null;
  }
}

function connect(c) {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const ws = (c.ws = new WebSocket(`${scheme}://${location.host}/ws?lang=${LANG}`));
  ws.binaryType = "arraybuffer";
  c.timeout = setTimeout(() => failCall(TEXT.serviceError), CONNECT_TIMEOUT_MS);

  ws.onmessage = ({ data }) => {
    if (call !== c) return;
    const type = typeof data === "string" ? JSON.parse(data).type : "audio";
    if (type === "ready") return goLive(c);
    if (c.live || type === "busy" || type === "error") handleMessage(c, data);
    else c.pending.push(data); // hold the greeting until the ringing stops
  };
  ws.onclose = () => {
    if (call !== c) return;
    if (c.live) endCall("dropped");
    else failCall(TEXT.serviceError);
  };
}

function handleMessage(c, data) {
  if (typeof data !== "string") {
    setAgentPlaying(c, true); // guard the mic before the first sample reaches the speakers
    return c.player.port.postMessage(data, [data]);
  }
  {
    const event = JSON.parse(data);
    switch (event.type) {
      case "transcript": return caption(event.role, event.text);
      case "turn_complete": c.lastRole = null; return;
      case "interrupt":
        c.interruptions = (c.interruptions || 0) + 1;
        c.player.port.postMessage("flush");
        c.lastRole = null;
        return;
      case "tool":
        c.toolsRunning = Math.max(0, c.toolsRunning + (event.phase === "start" ? 1 : -1));
        return updateLiveStatus();
      case "hangup": return c.player.port.postMessage("hangup");
      case "busy": return failCall(TEXT.busy);
      case "error": return failCall(TEXT.serviceError);
    }
  }
}

function goLive(c) {
  clearTimeout(c.timeout);
  const wait = Math.max(0, RING_MIN_MS - (performance.now() - c.ringStarted));
  setTimeout(() => {
    if (call !== c) return;
    c.ring.stop();
    c.live = true;
    c.startedAt = Date.now();
    setState("live");
    c.pending.forEach((d) => handleMessage(c, d));
    c.pending = [];
    updateLiveStatus();
    c.clock = setInterval(() => ($("timer").textContent = elapsed(c)), 500);
    $("timer").textContent = elapsed(c);
  }, wait);
}

function endCall(reason) {
  const c = call;
  if (!c) return;
  const duration = c.startedAt ? elapsed(c) : null;
  cleanup(c);
  if (reason === "dropped") return showError(TEXT.netError, true);
  $("timer").textContent = "";
  setStatus("");
  $("after-msg").textContent = TEXT.ended(duration || "00:00");
  $("again-label").textContent = TEXT.again;
  setState("ended");
  if (!panelOpen) showPanel(true);
}

function failCall(message) {
  if (!call) return;
  cleanup(call);
  showError(message, true);
}

function showError(message, retry) {
  $("timer").textContent = "";
  setStatus("");
  $("after-msg").textContent = message;
  $("again-label").textContent = TEXT.tryAgain;
  $("again").hidden = !retry;
  setState("error");
  showPanel(true);
}

function cleanup(c) {
  call = null;
  body.classList.remove("in-call");
  clearTimeout(c.timeout);
  clearInterval(c.clock);
  cancelAnimationFrame(c.raf);
  c.ring?.stop();
  if (c.ws) { c.ws.onclose = null; c.ws.close(); }
  c.stream?.getTracks().forEach((t) => t.stop());
  c.denoiser?.port.postMessage("destroy");
  c.captureCtx.close().catch(() => {});
  c.playCtx.close().catch(() => {});
  $("again").hidden = false;
  $("text-form").hidden = true;
  $("keyboard").setAttribute("aria-pressed", "false");
  body.style.setProperty("--user", 0);
  document.querySelectorAll(".stage-avatar svg").forEach((s) => s.style.setProperty("--mouth", 0));
}

// ---------- During the call ----------

function setAgentPlaying(c, playing) {
  if (c.agentPlaying === playing) return;
  c.agentPlaying = playing;
  c.capture?.port.postMessage({ agentSpeaking: playing });
  updateLiveStatus();
}

function debugLine(c, d) {
  const now = performance.now();
  if (now - (c.debugAt || 0) < 200) return;
  c.debugAt = now;
  $("hint").textContent =
    `mic ${d.raw.toFixed(3)} · ${d.guarding ? (d.pass ? "guard OPEN" : "guard closed") : "open"} · ` +
    `filter ${body.dataset.denoise} · interruptions ${c.interruptions || 0}`;
}

function updateLiveStatus() {
  const c = call;
  if (!c?.live) return;
  if (c.toolsRunning) setStatus(TEXT.checking + "…");
  else if (c.agentPlaying) setStatus(TEXT.speaking);
  else if (c.muted) setStatus(TEXT.muted);
  else setStatus(TEXT.listening);
}

function toggleMute() {
  const c = call;
  if (!c?.stream) return;
  c.muted = !c.muted;
  c.stream.getAudioTracks().forEach((t) => (t.enabled = !c.muted));
  $("mute").setAttribute("aria-pressed", String(c.muted));
  updateLiveStatus();
}

function toggleKeyboard() {
  const show = $("text-form").hidden;
  $("text-form").hidden = !show;
  $("keyboard").setAttribute("aria-pressed", String(show));
  if (show) $("text").focus();
}

function sendText(e) {
  e.preventDefault();
  const text = $("text").value.trim();
  const c = call;
  if (!text || !c?.live || c.ws.readyState !== WebSocket.OPEN) return;
  c.ws.send(JSON.stringify({ type: "text", text }));
  c.player.port.postMessage("flush"); // typing a question interrupts the assistant, like speaking would
  c.lastRole = null;
  caption("user", text);
  c.lastRole = null;
  $("text").value = "";
}

// Live captions: the last few lines, newest at the bottom.
function caption(role, text) {
  const c = call;
  if (!c) return;
  const box = $("captions");
  if (c.lastRole !== role || !box.lastElementChild) {
    const p = document.createElement("p");
    p.className = role;
    p.dir = "auto";
    box.append(p);
    c.lastRole = role;
    while (box.children.length > 4) box.firstElementChild.remove();
  }
  box.lastElementChild.textContent += text;
}

// Drive the avatar: mouth follows the assistant's voice, the gold glow follows the caller's.
function animate(c) {
  let mouth = 0, user = 0;
  const avatars = document.querySelectorAll(".stage-avatar svg, .launcher-avatar svg");
  const tick = () => {
    mouth += (Math.min(1, (c.agentLevel || 0) * 9) - mouth) * 0.45;
    user += (Math.min(1, (c.userLevel || 0) * 7) - user) * 0.3;
    avatars.forEach((s) => s.style.setProperty("--mouth", mouth.toFixed(3)));
    body.style.setProperty("--user", c.live ? user.toFixed(3) : 0);
    c.raf = requestAnimationFrame(tick);
  };
  tick();
}

function elapsed(c) {
  const s = Math.floor((Date.now() - c.startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// A soft UAE-style ringback (two short rings, then a pause) while the call connects.
function startRingback(ctx) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const oscs = [400, 450].map((f) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.connect(gain);
    o.start();
    return o;
  });
  const t0 = ctx.currentTime + 0.05;
  for (let k = 0; k < 15; k++) {
    const base = t0 + k * 3;
    [[0, 0.4], [0.6, 1.0]].forEach(([on, off]) => {
      gain.gain.setTargetAtTime(0.05, base + on, 0.015);
      gain.gain.setTargetAtTime(0, base + off, 0.015);
    });
  }
  return {
    stop() {
      try {
        gain.gain.cancelScheduledValues(0);
        gain.gain.value = 0;
        oscs.forEach((o) => o.stop());
        gain.disconnect();
      } catch {}
    },
  };
}
