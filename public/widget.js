(function () {
  "use strict";

  // ═══════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════
  var BASE_URL = window.BURGERJAZZ_CHAT_API || "https://burgerjazz-chatbot.vercel.app";
  var API_URL = BASE_URL + "/api/chat";
  var RATE_URL = BASE_URL + "/api/rate";
  var LOGO_URL = BASE_URL + "/logo.png";
  var SESSION_TTL = 30 * 60 * 1000;
  var MAX_MSG_LEN = 2000;

  var C = {
    navy: "#002855", yellow: "#F5E1A4", white: "#ffffff",
    bg: "#f9f9f7", border: "#e4e2dd", muted: "#6b7280",
    green: "#16a34a", red: "#dc2626",
  };

  // ═══════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════
  var messages = [];
  var isOpen = false;
  var isLoading = false;
  var hasRated = false;
  var userMsgCount = 0;
  var sessionId = "";
  var container = null;
  var chatBody = null;
  var restoredSession = false;

  // ═══════════════════════════════════════
  // SESSION PERSISTENCE (localStorage)
  // ═══════════════════════════════════════
  function genSessionId() {
    var arr = new Uint8Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (var i = 0; i < 8; i++) arr[i] = Math.floor(Math.random() * 256);
    var hex = "";
    for (var j = 0; j < arr.length; j++) hex += ("0" + arr[j].toString(16)).slice(-2);
    return "s_" + Date.now() + "_" + hex;
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem("bj_chat");
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (Date.now() - (d.ts || 0) > SESSION_TTL) {
        localStorage.removeItem("bj_chat");
        return false;
      }
      messages = d.msgs || [];
      sessionId = d.sid || "";
      userMsgCount = d.uc || 0;
      hasRated = d.hr || false;
      return messages.length > 0;
    } catch (e) { return false; }
  }

  function saveSession() {
    try {
      localStorage.setItem("bj_chat", JSON.stringify({
        msgs: messages.slice(-40),
        sid: sessionId,
        uc: userMsgCount,
        hr: hasRated,
        ts: Date.now()
      }));
    } catch (e) {}
  }

  // ═══════════════════════════════════════
  // UTILS
  // ═══════════════════════════════════════
  function escapeHTML(str) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  function fmtTime(ts) {
    return new Date(ts || Date.now()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }

  function parseMarkdown(safe) {
    return safe
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\n/g, "<br>");
  }

  // ═══════════════════════════════════════
  // FONTS
  // ═══════════════════════════════════════
  function injectFonts() {
    if (document.getElementById("bj-fonts")) return;
    var link = document.createElement("link");
    link.id = "bj-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap";
    document.head.appendChild(link);
    var ff = document.createElement("style");
    ff.textContent = '@font-face{font-family:"Garnett";src:url("' + BASE_URL + '/Garnett-Semibold.otf") format("opentype");font-weight:600;font-style:normal;font-display:swap}';
    document.head.appendChild(ff);
  }

  // ═══════════════════════════════════════
  // STYLES
  // ═══════════════════════════════════════
  function injectStyles() {
    var css = document.createElement("style");
    css.textContent = [
      '#bj-chat-toggle{position:fixed;bottom:20px;right:20px;width:62px;height:62px;border-radius:50%;background:'+C.white+';color:'+C.navy+';border:2px solid '+C.navy+';cursor:pointer;box-shadow:0 4px 24px rgba(1,19,63,.3);z-index:99999;display:flex;align-items:center;justify-content:center;transition:all .25s ease;font-family:"Lato",sans-serif}',
      '#bj-chat-toggle:hover{transform:scale(1.06);box-shadow:0 6px 32px rgba(1,19,63,.4)}',
      '#bj-chat-toggle.open{background:'+C.white+';border-color:'+C.navy+'}',
      '#bj-chat-toggle img{transition:transform .3s}',
      '#bj-chat-toggle.open img{transform:scale(.85)}',
      '#bj-chat-badge{position:absolute;top:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:'+C.red+';color:#fff;font-size:9px;font-weight:700;display:none;align-items:center;justify-content:center}',
      // Proactive bubble
      '#bj-chat-bubble{position:fixed;bottom:88px;right:20px;background:'+C.white+';color:'+C.navy+';padding:10px 16px;border-radius:16px 16px 4px 16px;box-shadow:0 4px 20px rgba(0,0,0,.12);font-family:"Lato",sans-serif;font-size:13px;font-weight:600;z-index:99998;opacity:0;transform:translateY(8px) scale(.95);transition:all .3s ease;pointer-events:none;max-width:220px;border:1px solid '+C.border+'}',
      '#bj-chat-bubble.show{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;cursor:pointer}',
      // Container
      '#bj-chat-container{position:fixed;bottom:92px;right:20px;width:380px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 110px);background:'+C.white+';border-radius:16px;box-shadow:0 12px 48px rgba(1,19,63,.2);z-index:99999;display:none;flex-direction:column;overflow:hidden;font-family:"Lato",sans-serif;border:1px solid '+C.border+'}',
      '#bj-chat-container.open{display:flex;animation:bjSlideUp .3s ease}',
      '@keyframes bjSlideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}',
      // Header
      '#bj-chat-header{background:'+C.navy+';color:'+C.white+';padding:16px 18px;display:flex;align-items:center;gap:12px;flex-shrink:0}',
      '#bj-chat-header-logo{width:46px;height:46px;border-radius:10px;object-fit:contain;border:none;background:'+C.white+';padding:6px}',
      '#bj-chat-header-info{flex:1}',
      '#bj-chat-header-name{font-family:"Garnett","Lato",sans-serif;font-weight:600;font-size:17px;letter-spacing:1.5px;text-transform:uppercase}',
      '#bj-chat-header-name sup{font-size:8px;vertical-align:super;letter-spacing:0}',
      '#bj-chat-header-status{font-size:11px;opacity:.7;font-weight:300;display:flex;align-items:center;gap:4px;transition:all .3s}',
      '#bj-chat-header-status .dot{width:6px;height:6px;border-radius:50%;background:'+C.green+';display:inline-block;transition:background .3s}',
      '#bj-chat-header-status.typing{opacity:1;font-weight:400}',
      '#bj-chat-header-status.typing .dot{background:'+C.yellow+';animation:bjPulse 1s infinite}',
      '@keyframes bjPulse{0%,100%{opacity:1}50%{opacity:.4}}',
      '#bj-chat-close{background:none;border:none;color:'+C.white+';font-size:22px;cursor:pointer;padding:4px 8px;opacity:.8;transition:opacity .2s;line-height:1}',
      '#bj-chat-close:hover{opacity:1}',
      // Body
      '#bj-chat-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:'+C.bg+';scroll-behavior:smooth}',
      '#bj-chat-body::-webkit-scrollbar{width:4px}',
      '#bj-chat-body::-webkit-scrollbar-thumb{background:'+C.border+';border-radius:4px}',
      // Messages
      '.bj-msg{max-width:84%;padding:11px 15px;border-radius:16px;font-size:13.5px;line-height:1.55;word-wrap:break-word;white-space:pre-wrap;font-family:"Lato",sans-serif;font-weight:400;animation:bjFadeIn .25s ease}',
      '@keyframes bjFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',
      '.bj-msg a{color:'+C.navy+';text-decoration:underline;font-weight:700}',
      '.bj-msg-bot{background:'+C.white+';color:'+C.navy+';align-self:flex-start;border-bottom-left-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.05);border:1px solid '+C.border+'}',
      '.bj-msg-user{background:'+C.navy+';color:'+C.white+';align-self:flex-end;border-bottom-right-radius:4px}',
      '.bj-msg-user a{color:'+C.yellow+'}',
      '.bj-msg-time{font-size:9px;opacity:.45;margin-top:4px;font-weight:300}',
      '.bj-msg.restored{animation:none}',
      // Typing
      '.bj-msg-typing{background:'+C.white+';align-self:flex-start;border-bottom-left-radius:4px;padding:14px 20px;box-shadow:0 1px 4px rgba(0,0,0,.05);border:1px solid '+C.border+'}',
      '.bj-dots{display:flex;gap:5px}',
      '.bj-dots span{width:7px;height:7px;border-radius:50%;background:'+C.navy+';opacity:.4;animation:bjBounce .6s infinite alternate}',
      '.bj-dots span:nth-child(2){animation-delay:.15s}',
      '.bj-dots span:nth-child(3){animation-delay:.3s}',
      '@keyframes bjBounce{to{opacity:1;transform:translateY(-5px)}}',
      // Quick replies
      '#bj-chat-quick{display:flex;flex-wrap:wrap;gap:6px;padding:4px 16px 10px;background:'+C.bg+'}',
      '.bj-quick-btn{background:'+C.white+';border:1px solid '+C.border+';border-radius:20px;padding:7px 14px;font-size:12px;color:'+C.navy+';cursor:pointer;font-family:"Lato",sans-serif;font-weight:600;transition:all .15s;letter-spacing:.2px}',
      '.bj-quick-btn:hover{background:'+C.navy+';color:'+C.white+';border-color:'+C.navy+'}',
      // Contact bar
      '.bj-contact-bar{display:flex;gap:6px;padding:4px 16px 8px;background:'+C.bg+'}',
      '.bj-contact-btn{display:flex;align-items:center;gap:5px;background:'+C.white+';border:1px solid '+C.border+';border-radius:10px;padding:8px 12px;font-size:11px;color:'+C.navy+';cursor:pointer;font-family:"Lato",sans-serif;font-weight:600;transition:all .15s;flex:1;justify-content:center}',
      '.bj-contact-btn:hover{background:'+C.navy+';color:'+C.white+';border-color:'+C.navy+'}',
      '.bj-contact-btn svg{width:14px;height:14px;flex-shrink:0}',
      // Input
      '#bj-chat-input-bar{display:flex;align-items:flex-end;gap:8px;padding:12px 14px;border-top:1px solid '+C.border+';background:'+C.white+';flex-shrink:0}',
      '#bj-chat-input{flex:1;border:1px solid '+C.border+';border-radius:12px;padding:10px 14px;font-size:13.5px;outline:none;font-family:"Lato",sans-serif;resize:none;max-height:80px;line-height:1.4;color:'+C.navy+';background:'+C.bg+';transition:border-color .2s}',
      '#bj-chat-input:focus{border-color:'+C.navy+'}',
      '#bj-chat-input::placeholder{color:'+C.muted+';font-weight:300}',
      '#bj-chat-send{width:38px;height:38px;border-radius:50%;background:'+C.navy+';color:'+C.white+';border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s}',
      '#bj-chat-send:hover:not(:disabled){background:'+C.white+';color:'+C.navy+'}',
      '#bj-chat-send:disabled{opacity:.3;cursor:default}',
      '#bj-chat-send svg{width:16px;height:16px}',
      // Rating
      '#bj-rating{padding:12px 16px;background:'+C.bg+';text-align:center;border-top:1px solid '+C.border+'}',
      '#bj-rating .bj-rate-label{font-size:12px;color:'+C.navy+';font-weight:700;margin-bottom:8px}',
      '#bj-rating .bj-rate-emojis{display:flex;justify-content:center;gap:8px}',
      '#bj-rating .bj-rate-btn{background:none;border:2px solid transparent;border-radius:12px;padding:6px 10px;font-size:28px;cursor:pointer;transition:all .2s;line-height:1}',
      '#bj-rating .bj-rate-btn:hover{transform:scale(1.25);border-color:'+C.navy+'}',
      '#bj-rating .bj-rate-btn.selected{border-color:'+C.navy+';background:'+C.yellow+';transform:scale(1.15)}',
      '#bj-rating .bj-rate-thanks{font-size:12px;color:'+C.green+';font-weight:700;padding:8px 0}',
      // Footer
      '#bj-chat-footer{text-align:center;font-size:9px;color:'+C.muted+';padding:6px;background:'+C.white+';flex-shrink:0;font-family:"Lato",sans-serif;letter-spacing:.3px}',
      '#bj-chat-footer a{color:'+C.navy+';text-decoration:none;font-weight:700}',
      // Mobile
      '@media(max-width:480px){#bj-chat-container{bottom:0;right:0;left:0;width:100%;height:100%;max-height:100vh;border-radius:0;border:none}#bj-chat-toggle{bottom:14px;right:14px;width:56px;height:56px}#bj-chat-bubble{bottom:78px;right:14px}}'
    ].join("");
    document.head.appendChild(css);
  }

  // ═══════════════════════════════════════
  // DOM CREATION
  // ═══════════════════════════════════════
  function createDOM() {
    // Toggle button
    var toggle = document.createElement("button");
    toggle.id = "bj-chat-toggle";
    toggle.setAttribute("aria-label", "Chat BurgerJazz");
    toggle.innerHTML =
      '<img src="' + LOGO_URL + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover" alt="BJ" onerror="this.outerHTML=\'<svg viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; stroke-width=&quot;2&quot;><path d=&quot;M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z&quot;/></svg>\'"><div id="bj-chat-badge">1</div>';
    toggle.onclick = toggleChat;
    document.body.appendChild(toggle);

    // Proactive notification bubble
    var bubble = document.createElement("div");
    bubble.id = "bj-chat-bubble";
    bubble.textContent = "Hola! Necesitas ayuda? \uD83C\uDF54";
    bubble.onclick = function () {
      bubble.classList.remove("show");
      if (!isOpen) toggleChat();
    };
    document.body.appendChild(bubble);

    // Chat container
    container = document.createElement("div");
    container.id = "bj-chat-container";
    container.innerHTML =
      '<div id="bj-chat-header">' +
      '<img id="bj-chat-header-logo" src="' + LOGO_URL + '" alt="BJ" onerror="this.src=\'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect width=%2240%22 height=%2240%22 rx=%228%22 fill=%22%23002855%22/><text x=%2220%22 y=%2226%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2216%22 font-weight=%22bold%22>BJ</text></svg>\'">' +
      '<div id="bj-chat-header-info"><div id="bj-chat-header-name"><img src="' + LOGO_URL + '" style="height:22px;object-fit:contain;display:block;filter:brightness(0) invert(1)" alt="BURGERJAZZ\u2122"></div><div id="bj-chat-header-status"><span class="dot"></span> Online</div></div>' +
      '<button id="bj-chat-close" aria-label="Cerrar">&times;</button>' +
      "</div>" +
      '<div id="bj-chat-body"></div>' +
      '<div id="bj-chat-quick"></div>' +
      '<div class="bj-contact-bar" id="bj-contact-bar"></div>' +
      '<div id="bj-rating" style="display:none"></div>' +
      '<div id="bj-chat-input-bar"><textarea id="bj-chat-input" rows="1" placeholder="Escribe tu mensaje..." maxlength="' + MAX_MSG_LEN + '"></textarea><button id="bj-chat-send" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div>' +
      '<div id="bj-chat-footer">Powered by <a href="https://burgerjazz.com" target="_blank" rel="noopener">BURGERJAZZ</a>\u2122</div>';
    document.body.appendChild(container);

    chatBody = document.getElementById("bj-chat-body");
    document.getElementById("bj-chat-close").onclick = toggleChat;
    document.getElementById("bj-chat-send").onclick = sendMessage;

    var input = document.getElementById("bj-chat-input");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 80) + "px";
    });

    renderContactBar();
  }

  function renderContactBar() {
    var bar = document.getElementById("bj-contact-bar");
    bar.innerHTML =
      '<button class="bj-contact-btn" onclick="window.open(\'mailto:info@burgerjazz.com\')">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>Email</button>' +
      '<button class="bj-contact-btn" onclick="window.open(\'https://www.instagram.com/burger_jazz/\',\'_blank\')">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>Instagram</button>' +
      '<button class="bj-contact-btn" onclick="window.open(\'https://burgerjazz.com\',\'_blank\')">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M14 10l6.1-6.1M9 21H3v-6M10 14l-6.1 6.1"/></svg>Web</button>';
  }

  // ═══════════════════════════════════════
  // HEADER STATUS
  // ═══════════════════════════════════════
  function setHeaderStatus(text, typing) {
    var el = document.getElementById("bj-chat-header-status");
    if (!el) return;
    el.innerHTML = '<span class="dot"></span> ' + escapeHTML(text);
    if (typing) el.classList.add("typing");
    else el.classList.remove("typing");
  }

  // ═══════════════════════════════════════
  // TOGGLE / OPEN / CLOSE
  // ═══════════════════════════════════════
  function toggleChat() {
    isOpen = !isOpen;
    container.classList.toggle("open", isOpen);
    document.getElementById("bj-chat-toggle").classList.toggle("open", isOpen);
    document.getElementById("bj-chat-badge").style.display = "none";

    // Hide proactive bubble
    var bubble = document.getElementById("bj-chat-bubble");
    if (bubble) bubble.classList.remove("show");

    if (isOpen && messages.length === 0) {
      showWelcome();
    }
    if (isOpen) {
      setTimeout(function () {
        var inp = document.getElementById("bj-chat-input");
        if (inp) inp.focus();
      }, 150);
      scrollBottom();
    }
    if (!isOpen && userMsgCount >= 2 && !hasRated) {
      isOpen = true;
      container.classList.add("open");
      document.getElementById("bj-chat-toggle").classList.add("open");
      showRating();
    }
  }

  // ═══════════════════════════════════════
  // WELCOME & RESTORED SESSION
  // ═══════════════════════════════════════
  function showWelcome() {
    addBotMessage("Hey! \uD83D\uDC4B Bienvenido a BURGERJAZZ\u2122. Soy JazzBot, en que puedo ayudarte?");
    showQuickReplies([
      "Quiero hacer un pedido",
      "Tengo una duda",
      "Necesito ayuda con un problema",
    ]);
  }

  function restoreMessages() {
    chatBody.innerHTML = "";
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      renderMessage(m.content, m.role === "assistant" ? "bot" : "user", m.ts, true);
    }
    // Show "session restored" divider
    var divider = document.createElement("div");
    divider.style.cssText = "text-align:center;font-size:10px;color:" + C.muted + ";padding:8px 0;opacity:.6";
    divider.textContent = "Conversacion anterior restaurada";
    chatBody.appendChild(divider);
    scrollBottom();
  }

  // ═══════════════════════════════════════
  // QUICK REPLIES
  // ═══════════════════════════════════════
  function showQuickReplies(options) {
    var qc = document.getElementById("bj-chat-quick");
    if (!qc || !options || !options.length) { if (qc) qc.innerHTML = ""; return; }
    qc.innerHTML = "";
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.className = "bj-quick-btn";
      btn.textContent = opt;
      btn.onclick = function () {
        qc.innerHTML = "";
        sendUserMessage(opt);
      };
      qc.appendChild(btn);
    });
  }

  // ═══════════════════════════════════════
  // MESSAGE RENDERING
  // ═══════════════════════════════════════
  function addBotMessage(text, quickReplies) {
    var ts = Date.now();
    messages.push({ role: "assistant", content: text, ts: ts });
    renderMessage(text, "bot", ts, false);
    saveSession();
    if (quickReplies && quickReplies.length) {
      showQuickReplies(quickReplies);
    }
  }

  function addUserMessage(text) {
    var ts = Date.now();
    messages.push({ role: "user", content: text, ts: ts });
    renderMessage(text, "user", ts, false);
    saveSession();
  }

  function renderMessage(text, type, ts, isRestored) {
    var wrapper = document.createElement("div");
    wrapper.className = "bj-msg bj-msg-" + type + (isRestored ? " restored" : "");

    // Sanitize then markdown
    var safe = escapeHTML(text);
    var html = parseMarkdown(safe);
    wrapper.innerHTML = html;

    // Timestamp
    var timeEl = document.createElement("div");
    timeEl.className = "bj-msg-time";
    timeEl.textContent = fmtTime(ts);
    wrapper.appendChild(timeEl);

    chatBody.appendChild(wrapper);
    if (!isRestored) scrollBottom();
  }

  // ═══════════════════════════════════════
  // TYPING INDICATOR
  // ═══════════════════════════════════════
  function showTyping() {
    setHeaderStatus("Escribiendo...", true);
    var div = document.createElement("div");
    div.className = "bj-msg bj-msg-typing";
    div.id = "bj-typing";
    div.innerHTML = '<div class="bj-dots"><span></span><span></span><span></span></div>';
    chatBody.appendChild(div);
    scrollBottom();
  }

  function hideTyping() {
    setHeaderStatus("Online", false);
    var t = document.getElementById("bj-typing");
    if (t) t.remove();
  }

  function scrollBottom() {
    setTimeout(function () {
      if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
    }, 60);
  }

  // ═══════════════════════════════════════
  // SEND MESSAGE
  // ═══════════════════════════════════════
  function sendMessage() {
    var input = document.getElementById("bj-chat-input");
    var text = input.value.trim();
    if (!text || isLoading) return;
    if (text.length > MAX_MSG_LEN) text = text.slice(0, MAX_MSG_LEN);
    input.value = "";
    input.style.height = "auto";
    sendUserMessage(text);
  }

  function sendUserMessage(text) {
    addUserMessage(text);
    userMsgCount++;
    document.getElementById("bj-chat-quick").innerHTML = "";
    isLoading = true;
    document.getElementById("bj-chat-send").disabled = true;
    showTyping();

    var apiMessages = messages.map(function (m) {
      return { role: m.role, content: m.content };
    });

    fetchWithRetry(apiMessages, 0);
  }

  function fetchWithRetry(apiMessages, attempt) {
    var controller = null;
    var timeoutId = null;

    // AbortController for timeout (25s)
    if (window.AbortController) {
      controller = new AbortController();
      timeoutId = setTimeout(function () { controller.abort(); }, 25000);
    }

    var fetchOpts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages, sessionId: sessionId }),
    };
    if (controller) fetchOpts.signal = controller.signal;

    fetch(API_URL, fetchOpts)
      .then(function (r) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        hideTyping();
        isLoading = false;
        document.getElementById("bj-chat-send").disabled = false;

        if (data.reply) {
          addBotMessage(data.reply, data.quickReplies || null);
          if (userMsgCount >= 3 && !hasRated) showRating();
        } else {
          addBotMessage("Disculpa, algo ha fallado. Escribe a info@burgerjazz.com y te ayudamos.");
        }
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);

        // Retry once on network error
        if (attempt < 1) {
          setTimeout(function () {
            fetchWithRetry(apiMessages, attempt + 1);
          }, 1500);
          return;
        }

        hideTyping();
        isLoading = false;
        document.getElementById("bj-chat-send").disabled = false;

        var msg = err && err.name === "AbortError"
          ? "La respuesta esta tardando demasiado. Intentalo de nuevo en unos segundos."
          : "Vaya, problemas de conexion. Intentalo de nuevo en unos segundos.";
        addBotMessage(msg);
      });
  }

  // ═══════════════════════════════════════
  // RATING
  // ═══════════════════════════════════════
  function showRating() {
    if (hasRated) return;
    var el = document.getElementById("bj-rating");
    var emojis = [
      { emoji: "\uD83D\uDE21", val: 1 },
      { emoji: "\uD83D\uDE15", val: 2 },
      { emoji: "\uD83D\uDE10", val: 3 },
      { emoji: "\uD83D\uDE0A", val: 4 },
      { emoji: "\uD83E\uDD29", val: 5 }
    ];
    el.innerHTML = '<div class="bj-rate-label">Que tal tu experiencia?</div><div class="bj-rate-emojis">' +
      emojis.map(function (e) {
        return '<button class="bj-rate-btn" data-val="' + e.val + '">' + e.emoji + '</button>';
      }).join("") + '</div>';
    el.style.display = "block";
    el.querySelectorAll(".bj-rate-btn").forEach(function (btn) {
      btn.onclick = function () {
        hasRated = true;
        saveSession();
        var val = parseInt(btn.dataset.val);
        el.querySelectorAll(".bj-rate-btn").forEach(function (b) { b.classList.remove("selected"); });
        btn.classList.add("selected");
        fetch(RATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId, rating: val })
        }).catch(function () {});
        setTimeout(function () {
          el.innerHTML = '<div class="bj-rate-thanks">Gracias por tu valoracion!</div>';
          setTimeout(function () { el.style.display = "none"; }, 2500);
        }, 600);
      };
    });
  }

  // ═══════════════════════════════════════
  // PROACTIVE ENGAGEMENT
  // ═══════════════════════════════════════
  function setupProactive() {
    // Don't show if user already interacted in this browser session
    if (sessionStorage.getItem("bj_greeted")) return;

    setTimeout(function () {
      if (isOpen) return;
      // Show badge
      document.getElementById("bj-chat-badge").style.display = "flex";

      // Show bubble after 6s more
      setTimeout(function () {
        if (isOpen) return;
        var bubble = document.getElementById("bj-chat-bubble");
        if (bubble) {
          bubble.classList.add("show");
          sessionStorage.setItem("bj_greeted", "1");
          // Auto-hide after 8s
          setTimeout(function () {
            bubble.classList.remove("show");
          }, 8000);
        }
      }, 6000);
    }, 3500);
  }

  // ═══════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════
  function boot() {
    injectFonts();
    injectStyles();

    // Try to restore previous session
    restoredSession = loadSession();
    if (!sessionId) sessionId = genSessionId();

    createDOM();

    // If we restored a session, render the old messages
    if (restoredSession) {
      restoreMessages();
    }

    setupProactive();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
