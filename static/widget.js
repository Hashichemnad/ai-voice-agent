/*!
 * Ajman Department of Finance voice assistant: website widget.
 *
 * Add one line to any page, before </body>:
 *   <script src="https://YOUR-APP.onrender.com/widget.js" defer></script>
 *
 * Options (attributes on the script tag):
 *   data-lang="auto|en|ar"     Language of the widget. "auto" (default) follows the page's <html lang>.
 *   data-position="right|left" Corner for the character. Default: right.
 *   data-greeting="on|off"     Show the "Need help?" bubble a few seconds after the page loads. Default: on.
 *
 * Open the panel from your own button or link:
 *   <button onclick="AjmanDofVoice.open()">Talk to us</button>
 */
(function () {
  if (window.AjmanDofVoice) return;
  var script = document.currentScript;
  var base = new URL(".", script.src);
  var origin = base.origin;
  var opt = function (name, fallback) { return script.getAttribute("data-" + name) || fallback; };

  var pageLang = (document.documentElement.lang || "").toLowerCase();
  var lang = opt("lang", "auto");
  if (lang === "auto") lang = pageLang.indexOf("ar") === 0 || /\/ar(\/|$)/.test(location.pathname) ? "ar" : "en";
  var side = opt("position", "right") === "left" ? "left" : "right";
  var GAP = 12, CLOSED = 112;

  var frame = document.createElement("iframe");
  frame.src = new URL("call.html?embed=1&lang=" + lang + "&pos=" + side, base).href;
  frame.title = lang === "ar" ? "المساعد الصوتي لدائرة المالية بعجمان" : "Ajman Department of Finance voice assistant";
  frame.allow = "microphone; autoplay";
  frame.setAttribute("allowtransparency", "true");
  var s = frame.style;
  s.position = "fixed"; s.border = "0"; s.background = "transparent"; s.colorScheme = "normal";
  s.zIndex = "2147483000"; s.width = CLOSED + "px"; s.height = CLOSED + "px";
  s.bottom = "0"; s[side] = "0"; s.maxWidth = "100vw"; s.maxHeight = "100vh";

  var open = false;
  function layout() {
    if (!open) {
      s.width = s.height = CLOSED + "px"; s.bottom = "0"; s[side] = "0"; s.borderRadius = "0";
    } else if (window.innerWidth < 480) {
      s.width = "100vw"; s.height = "100dvh"; s.bottom = "0"; s[side] = "0"; s.borderRadius = "0";
    } else {
      s.width = "380px"; s.height = Math.min(640, window.innerHeight - 2 * GAP) + "px";
      s.bottom = GAP + "px"; s[side] = GAP + "px"; s.borderRadius = "22px";
    }
  }
  window.addEventListener("resize", layout);
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || e.source !== frame.contentWindow || !e.data || e.data.source !== "dof-voice") return;
    open = !!e.data.open;
    layout();
    if (open) hideBubble();
  });

  // ---- Greeting bubble (in a shadow root so the website's CSS can't affect it) ----
  var host = document.createElement("div");
  var bubbleShown = false, root, bubble;
  function showBubble() {
    if (open || bubbleShown || opt("greeting", "on") === "off") return;
    try { if (sessionStorage.getItem("dofVoiceBubble") === "closed") return; } catch (e) {}
    bubbleShown = true;
    root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var text = lang === "ar"
      ? "عندك استفسار عن خدماتنا؟ <b>تحدّث مع حمدان</b>"
      : "Questions about our services? <b>Talk to Hamdan</b>";
    root.innerHTML =
      "<style>" +
      ".b{position:fixed;bottom:34px;" + side + ":" + (CLOSED + 2) + "px;z-index:2147483000;max-width:min(240px,calc(100vw - 140px));" +
      "display:flex;align-items:flex-start;gap:6px;padding:12px 10px 12px 16px;border-radius:16px;background:#fff;color:#12262B;" +
      "font:15px/1.45 'IBM Plex Sans Arabic','Segoe UI',Tahoma,system-ui,sans-serif;box-shadow:0 8px 26px rgba(18,38,43,.22);" +
      "animation:in .35s cubic-bezier(.2,.9,.3,1.2);direction:" + (lang === "ar" ? "rtl" : "ltr") + "}" +
      ".b::after{content:'';position:absolute;bottom:18px;" + side + ":-6px;width:12px;height:12px;background:#fff;transform:rotate(45deg)}" +
      ".t{all:unset;cursor:pointer;flex:1}.t b{color:#0E4F55}.t:focus-visible,.x:focus-visible{outline:3px solid #C79A3B;outline-offset:2px;border-radius:6px}" +
      ".x{all:unset;cursor:pointer;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;color:#5E7378;font-size:18px;line-height:1}" +
      ".x:hover{background:#EEF3F3}@keyframes in{from{opacity:0;transform:translateY(8px) scale(.95)}}" +
      "@media (prefers-reduced-motion:reduce){.b{animation:none}}" +
      "</style><div class='b' role='status'><button class='t' type='button'>" + text + "</button>" +
      "<button class='x' type='button' aria-label='" + (lang === "ar" ? "إغلاق" : "Close") + "'>×</button></div>";
    bubble = root.querySelector(".b");
    root.querySelector(".t").onclick = function () { api.open(); };
    root.querySelector(".x").onclick = function () {
      hideBubble();
      try { sessionStorage.setItem("dofVoiceBubble", "closed"); } catch (e) {}
    };
    setTimeout(hideBubble, 15000);
  }
  function hideBubble() { if (bubble) { bubble.remove(); bubble = null; } }

  var api = {
    open: function () {
      frame.contentWindow && frame.contentWindow.postMessage({ source: "dof-voice-host", action: "open" }, origin);
    },
  };
  window.AjmanDofVoice = api;

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(host);
    setTimeout(showBubble, 3000);
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
