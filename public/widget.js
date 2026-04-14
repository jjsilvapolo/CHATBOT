(function () {
  "use strict";

  // ═══════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════
  var BASE_URL = window.BURGERJAZZ_CHAT_API || "https://burgerjazz-chatbot.vercel.app";
  var API_URL = BASE_URL + "/api/chat";
  var RATE_URL = BASE_URL + "/api/rate";
  var FEEDBACK_URL = BASE_URL + "/api/feedback";
  var LOGO_URL = BASE_URL + "/logo.png";
  var SESSION_TTL = 30 * 60 * 1000;
  var MAX_MSG_LEN = 2000;
  var USE_STREAMING = true;

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
  var hasConsented = false;
  var userMsgCount = 0;
  var sessionId = "";
  var container = null;
  var chatBody = null;
  var restoredSession = false;

  // ═══════════════════════════════════════
  // i18n - MULTI-LANGUAGE
  // ═══════════════════════════════════════
  var LANG = "es";
  var I18N = {
    es: {
      welcome: "Hey! \uD83D\uDC4B Bienvenido a BURGERJAZZ\u2122. Soy JazzBot, en que puedo ayudarte?",
      placeholder: "Escribe tu mensaje...",
      consentPlaceholder: "Acepta la politica de privacidad para continuar...",
      quickOrder: "Quiero hacer un pedido",
      quickHelp: "Tengo una duda",
      quickProblem: "Necesito ayuda con un problema",
      privacy: 'Al usar este chat, aceptas que BURGERJAZZ trate tus datos de conversacion para atenderte, conforme al <a href="https://burgerjazz.com/politica-de-privacidad" target="_blank" rel="noopener">RGPD y nuestra Politica de Privacidad</a>. Tus datos se conservan 12 meses y puedes solicitar su eliminacion en cualquier momento.',
      privacyAccept: "Aceptar y continuar",
      deleteConfirm: "Se eliminaran tus datos de conversacion. Continuar?",
      deleteSuccess: "Tus datos han sido eliminados. Si necesitas ayuda, estamos aqui.",
      deleteFail: "No se han podido eliminar los datos. Escribe a info@burgerjazz.com para solicitarlo.",
      deleteBtn: "Eliminar mis datos",
      rateLabel: "Valora tu experiencia",
      rateAsk: "Te he sido util? Valorame aqui abajo, me ayuda a mejorar \uD83D\uDC47",
      rateThanks: "Gracias por tu valoracion! \uD83D\uDE4F",
      restored: "Conversacion anterior restaurada",
      bubble: "Hola! Necesitas ayuda? \uD83C\uDF54",
      timeout: "La respuesta esta tardando demasiado. Intentalo de nuevo en unos segundos.",
      netError: "Vaya, problemas de conexion. Intentalo de nuevo en unos segundos.",
      apiFail: "Disculpa, algo ha fallado. Escribe a info@burgerjazz.com y te ayudamos.",
      open: "Abierto ahora",
      closed: "Cerrado ahora",
      online: "Online",
    },
    en: {
      welcome: "Hey! \uD83D\uDC4B Welcome to BURGERJAZZ\u2122. I'm JazzBot, how can I help?",
      placeholder: "Type your message...",
      consentPlaceholder: "Accept the privacy policy to continue...",
      quickOrder: "I want to order",
      quickHelp: "I have a question",
      quickProblem: "I need help with an issue",
      privacy: 'By using this chat, you accept that BURGERJAZZ processes your conversation data to assist you, in accordance with <a href="https://burgerjazz.com/politica-de-privacidad" target="_blank" rel="noopener">GDPR and our Privacy Policy</a>. Data is kept 12 months. You can request deletion at any time.',
      privacyAccept: "Accept and continue",
      deleteConfirm: "Your conversation data will be deleted. Continue?",
      deleteSuccess: "Your data has been deleted. If you need help, we're here.",
      deleteFail: "Could not delete data. Write to info@burgerjazz.com to request it.",
      deleteBtn: "Delete my data",
      rateLabel: "Rate your experience",
      rateAsk: "Was I helpful? Rate me below, it helps me improve \uD83D\uDC47",
      rateThanks: "Thanks for your rating! \uD83D\uDE4F",
      restored: "Previous conversation restored",
      bubble: "Hi! Need help? \uD83C\uDF54",
      timeout: "The response is taking too long. Try again in a few seconds.",
      netError: "Connection issues. Try again in a few seconds.",
      apiFail: "Sorry, something went wrong. Write to info@burgerjazz.com for help.",
      open: "Open now",
      closed: "Closed now",
      online: "Online",
    }
  };
  function t(key) { return (I18N[LANG] || I18N.es)[key] || (I18N.es[key] || key); }

  function detectBrowserLang() {
    var nav = (navigator.language || navigator.userLanguage || "es").slice(0, 2).toLowerCase();
    return I18N[nav] ? nav : "es";
  }

  // ═══════════════════════════════════════
  // SCHEDULE DATA - "ABIERTO AHORA"
  // ═══════════════════════════════════════
  var SCHEDULES = {
    "Plaza Espana":  { days: { "1":[12.5,16,19.5,24], "2":[12.5,16,19.5,24], "3":[12.5,16,19.5,24], "4":[12.5,16,19.5,24], "5":[12.5,24], "6":[12.5,24], "0":[12.5,24] }},
    "Delicias":      { days: { "1":null, "2":null, "3":[12.5,16,19.5,23.5], "4":[12.5,16,19.5,23.5], "5":[12.5,24], "6":[12.5,24], "0":[12.5,24] }},
    "Chamberi":      { days: { "1":[12.5,16,19.5,23.5], "2":[12.5,16,19.5,23.5], "3":[12.5,16,19.5,23.5], "4":[12.5,16,19.5,23.5], "5":[12.5,16.5,19.5,24], "6":[12.5,16.5,19.5,24], "0":[12.5,16.5,19.5,24] }},
    "Retiro":        { days: { "1":null, "2":null, "3":[12.5,16,19.5,23.5], "4":[12.5,16,19.5,23.5], "5":[12.5,16.5,19.5,24], "6":[12.5,16.5,19.5,24], "0":[12.5,16.5,19.5,24] }},
    "Pozuelo":       { days: { "1":null, "2":null, "3":[12.5,16,19.5,23.5], "4":[12.5,16,19.5,23.5], "5":[12.5,16.5,19.5,24], "6":[12.5,16.5,19.5,24], "0":[12.5,16.5,19.5,24] }},
    "Majadahonda":   { days: { "1":[12.5,16,19.5,23.5], "2":[12.5,16,19.5,23.5], "3":[12.5,16,19.5,23.5], "4":[12.5,16,19.5,23.5], "5":[12.5,16.5,19.5,24], "6":[12.5,16.5,19.5,24], "0":[12.5,16.5,19.5,24] }},
    "Alcorcon":      { days: { "1":null, "2":null, "3":[12.5,16,19.5,23.5], "4":[12.5,16,19.5,23.5], "5":[12.5,16,19.5,23.5], "6":[12.5,16,19.5,23.5], "0":[12.5,16,19.5,23.5] }},
    "Mirasierra":    { days: { "1":null, "2":null, "3":[12.5,16,19.5,23.5], "4":[12.5,16,19.5,23.5], "5":[12.5,16.5,19.5,24], "6":[12.5,16.5,19.5,24], "0":[12.5,16.5,19.5,24] }},
    "Alcobendas":    { days: { "1":null, "2":null, "3":[12.5,16,19.5,23], "4":[12.5,16,19.5,23], "5":[12.5,16.5,19.5,23.5], "6":[12.5,16.5,19.5,23.5], "0":[12.5,16.5,19.5,23.5] }},
    "Valladolid":    { days: { "1":[12.5,16], "2":[12.5,16], "3":[12.5,16,19.5,23.5], "4":[12.5,16,19.5,23.5], "5":[12.5,16.5,19.5,23.5], "6":[12.5,16.5,19.5,23.5], "0":[12.5,16.5,19.5,23.5] }},
  };

  function isAnyOpen() {
    var now = new Date();
    var day = String(now.getDay()); // 0=Sun
    var hour = now.getHours() + now.getMinutes() / 60;
    for (var name in SCHEDULES) {
      var s = SCHEDULES[name].days[day];
      if (!s) continue; // closed today
      // s is [open1, close1] or [open1, close1, open2, close2]
      for (var i = 0; i < s.length; i += 2) {
        if (hour >= s[i] && hour < s[i + 1]) return { open: true, name: name };
      }
    }
    return { open: false, name: null };
  }

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
      hasConsented = d.consent || false;
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
        consent: hasConsented,
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
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#002855;text-decoration:underline">$1</a>')
      .replace(/(^|[\s>])(https?:\/\/[^\s<)"]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#002855;text-decoration:underline">$2</a>')
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
      '#bj-chat-badge{position:absolute;top:-2px;right:-2px;width:18px;height:18px;border-radius:50%;background:'+C.red+';color:#fff;font-size:9px;font-weight:700;display:none;align-items:center;justify-content:center;animation:bjBadgePulse 2s infinite}',
      '@keyframes bjBadgePulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.5)}50%{box-shadow:0 0 0 8px rgba(220,38,38,0)}}',
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
      '@keyframes bj-fade-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
      '#bj-rating{padding:14px 16px;background:linear-gradient(135deg,'+C.navy+',#003d7a);text-align:center;border-top:1px solid '+C.border+';border-radius:0 0 16px 16px}',
      '#bj-rating .bj-rate-label{font-size:13px;color:#fff;font-weight:700;margin-bottom:10px}',
      '#bj-rating .bj-rate-emojis{display:flex;justify-content:center;gap:6px}',
      '#bj-rating .bj-rate-btn{background:rgba(255,255,255,.1);border:2px solid transparent;border-radius:12px;padding:8px 10px;font-size:28px;cursor:pointer;transition:all .2s;line-height:1;color:#fff}',
      '#bj-rating .bj-rate-btn:hover{transform:scale(1.2);border-color:'+C.yellow+';background:rgba(255,255,255,.2)}',
      '#bj-rating .bj-rate-btn.selected{border-color:'+C.yellow+';background:'+C.yellow+';transform:scale(1.15)}',
      '#bj-rating .bj-rate-thanks{font-size:13px;color:'+C.yellow+';font-weight:700;padding:10px 0}',
      // Privacy notice
      '#bj-privacy{padding:14px 16px;background:#f9f9f7;border-bottom:1px solid '+C.border+';font-size:11px;color:'+C.muted+';line-height:1.5}',
      '#bj-privacy a{color:'+C.navy+';text-decoration:underline}',
      '#bj-privacy-accept{display:inline-block;margin-top:8px;background:'+C.navy+';color:#fff;border:none;border-radius:8px;padding:6px 16px;font-size:11px;font-weight:700;cursor:pointer;font-family:"Lato",sans-serif}',
      '#bj-privacy-accept:hover{opacity:.9}',
      // Delete data link
      '.bj-delete-data{font-size:9px;color:'+C.muted+';cursor:pointer;text-decoration:underline;margin-top:2px}',
      '.bj-delete-data:hover{color:'+C.red+'}',
      // Footer
      '#bj-chat-footer{text-align:center;font-size:9px;color:'+C.muted+';padding:6px;background:'+C.white+';flex-shrink:0;font-family:"Lato",sans-serif;letter-spacing:.3px}',
      '#bj-chat-footer a{color:'+C.navy+';text-decoration:none;font-weight:700}',
      // Inline feedback (thumbs)
      '.bj-feedback{display:flex;gap:4px;margin-top:6px}',
      '.bj-feedback button{background:none;border:1px solid '+C.border+';border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer;opacity:.6;transition:all .15s}',
      '.bj-feedback button:hover{opacity:1;border-color:'+C.navy+'}',
      '.bj-feedback button.voted{opacity:1;border-color:'+C.navy+';background:'+C.navy+';color:#fff}',
      '.bj-feedback button.voted-down{border-color:'+C.red+';background:'+C.red+';color:#fff}',
      // Open indicator
      '.bj-open-tag{display:inline-block;font-size:9px;padding:1px 6px;border-radius:4px;font-weight:700;margin-left:6px}',
      '.bj-open-tag.open{background:#dcfce7;color:#16a34a}',
      '.bj-open-tag.closed{background:#fee2e2;color:#dc2626}',
      // Confetti
      '@keyframes bjConfetti{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(120px) rotate(720deg);opacity:0}}',
      '.bj-confetti{position:absolute;width:8px;height:8px;border-radius:2px;animation:bjConfetti 1.2s ease-out forwards;pointer-events:none;z-index:10}',
      // Resolved banner
      '.bj-resolved{background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;padding:10px 16px;border-radius:12px;text-align:center;font-size:12px;font-weight:700;margin:8px 0;animation:bjFadeIn .3s ease}',
      // Order CTA button
      '.bj-order-cta{display:inline-block;background:#002855;color:#fff;padding:8px 16px;border-radius:20px;font-size:12px;font-weight:700;text-decoration:none;margin-top:6px;transition:all .15s}',
      '.bj-order-cta:hover{background:#F5E1A4;color:#002855}',
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
    bubble.textContent = t("bubble");
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
      '<div id="bj-privacy" style="display:none"></div>' +
      '<div id="bj-chat-input-bar"><textarea id="bj-chat-input" rows="1" placeholder="Escribe tu mensaje..." maxlength="' + MAX_MSG_LEN + '"></textarea><button id="bj-chat-send" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div>' +
      '<div id="bj-chat-footer">Powered by <a href="https://burgerjazz.com" target="_blank" rel="noopener">BURGERJAZZ</a>\u2122 | <span class="bj-delete-data" id="bj-delete-data">' + t("deleteBtn") + '</span></div>';
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

    // Delete data button
    var delBtn = document.getElementById("bj-delete-data");
    if (delBtn) {
      delBtn.onclick = function () {
        if (!confirm(t("deleteConfirm"))) return;
        // Call delete API
        fetch(BASE_URL + "/api/delete-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId })
        }).then(function (r) { return r.json(); }).then(function () {
          messages = [];
          userMsgCount = 0;
          hasRated = false;
          hasConsented = false;
          localStorage.removeItem("bj_chat");
          sessionId = genSessionId();
          chatBody.innerHTML = "";
          addBotMessage(t("deleteSuccess"));
          showPrivacyNotice();
        }).catch(function () {
          addBotMessage(t("deleteFail"));
        });
      };
    }
  }

  function renderContactBar() {
    var bar = document.getElementById("bj-contact-bar");
    bar.innerHTML =
      '<button class="bj-contact-btn" onclick="window.open(\'mailto:info@burgerjazz.com\')">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>Email</button>' +
      '<button class="bj-contact-btn" onclick="window.open(\'https://www.instagram.com/burger_jazz/\',\'_blank\')">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>Instagram</button>' +
      '<button class="bj-contact-btn" style="background:#002855;color:#fff;border-color:#002855" onclick="window.open(\'https://burgerjazz.com/pide-ya\',\'_blank\')">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>Pedir Ya!</button>';
  }

  // ═══════════════════════════════════════
  // HEADER STATUS
  // ═══════════════════════════════════════
  function setHeaderStatus(text, typing) {
    var el = document.getElementById("bj-chat-header-status");
    if (!el) return;
    var openStatus = isAnyOpen();
    var openTag = openStatus.open
      ? '<span class="bj-open-tag open">' + t("open") + '</span>'
      : '<span class="bj-open-tag closed">' + t("closed") + '</span>';
    el.innerHTML = '<span class="dot"></span> ' + escapeHTML(text) + openTag;
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
    // When closing: show farewell + rating
    if (!isOpen && userMsgCount >= 2) {
      if (!hasRated) showRating();
    }
  }

  // ═══════════════════════════════════════
  // WELCOME & RESTORED SESSION
  // ═══════════════════════════════════════
  function showPrivacyNotice() {
    var el = document.getElementById("bj-privacy");
    if (!el) return;
    el.style.display = "block";
    el.innerHTML = t("privacy") + '<br><button id="bj-privacy-accept">' + t("privacyAccept") + '</button>';
    var inp = document.getElementById("bj-chat-input");
    var btn = document.getElementById("bj-chat-send");
    if (inp) { inp.disabled = true; inp.placeholder = t("consentPlaceholder"); }
    if (btn) btn.disabled = true;
    document.getElementById("bj-privacy-accept").onclick = function () {
      hasConsented = true;
      el.style.display = "none";
      if (inp) { inp.disabled = false; inp.placeholder = t("placeholder"); }
      if (btn) btn.disabled = false;
      saveSession();
      if (inp) inp.focus();
    };
  }

  function getSmartWelcome() {
    var now = new Date();
    var hour = now.getHours();
    var day = now.getDay(); // 0=Sun
    var openInfo = isAnyOpen();

    // Jazz Days: Wednesday
    if (day === 3 && hour >= 10 && hour < 23) {
      return {
        msg: "Hoy es JAZZ DAY! 2x1 en burgers en todos los locales \uD83C\uDFB7 En que puedo ayudarte?",
        replies: [LANG === "en" ? "Tell me about Jazz Days" : "Cuanto es el 2x1?", LANG === "en" ? "I want to order" : "Quiero pedir", LANG === "en" ? "Help me choose" : "Ayudame a elegir"]
      };
    }
    // Lunch time (12-15h)
    if (hour >= 12 && hour < 15 && openInfo.open) {
      return {
        msg: "Buenas! Justo a tiempo para comer \uD83C\uDF54 Que te apetece?",
        replies: [LANG === "en" ? "See the menu" : "Ver la carta", LANG === "en" ? "Help me choose" : "Ayudame a elegir burger", LANG === "en" ? "Nearest location" : "Local mas cercano"]
      };
    }
    // Dinner time (19:30-22h)
    if (hour >= 19 && hour < 22 && openInfo.open) {
      return {
        msg: "Buenas noches! Hora de cenar \uD83C\uDF1F Que necesitas?",
        replies: [LANG === "en" ? "I want to order" : "Quiero hacer un pedido", LANG === "en" ? "See the menu" : "Ver la carta", LANG === "en" ? "Opening hours" : "Horarios"]
      };
    }
    // Late night
    if (hour >= 22 || hour < 2) {
      return {
        msg: "Antojazo nocturno? \uD83C\uDF19 Te ayudo a encontrar un local abierto o a hacer tu pedido.",
        replies: [LANG === "en" ? "Open locations" : "Que locales estan abiertos?", LANG === "en" ? "Order online" : "Pedir por la web", LANG === "en" ? "I have a question" : "Tengo una duda"]
      };
    }
    // Closed / morning
    if (hour >= 6 && hour < 12) {
      return {
        msg: "Buenos dias! \u2615 Abrimos a las 12:30. Mientras, en que puedo ayudarte?",
        replies: [LANG === "en" ? "See the menu" : "Ver la carta", LANG === "en" ? "Opening hours" : "Horarios de mi local", LANG === "en" ? "Help me choose" : "Ayudame a elegir"]
      };
    }
    // Default
    return {
      msg: t("welcome"),
      replies: [t("quickOrder"), t("quickHelp"), LANG === "en" ? "Help me choose a burger" : "Ayudame a elegir burger"]
    };
  }

  function showWelcome() {
    var welcome = getSmartWelcome();
    addBotMessage(welcome.msg);
    showQuickReplies(welcome.replies);
    if (!hasConsented) showPrivacyNotice();
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
    divider.textContent = t("restored");
    chatBody.appendChild(divider);
    scrollBottom();
  }

  // ═══════════════════════════════════════
  // QUICK REPLIES
  // ═══════════════════════════════════════
  function showQuickReplies(options) {
    var qc = document.getElementById("bj-chat-quick");
    if (!qc || !options || !options.length || !hasConsented) { if (qc) qc.innerHTML = ""; return; }
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
  function addBotMessage(text, quickReplies, chatId) {
    var ts = Date.now();
    messages.push({ role: "assistant", content: text, ts: ts });
    renderMessage(text, "bot", ts, false, chatId);
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

  function renderMessage(text, type, ts, isRestored, chatId) {
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

    // Enhance bot messages (CTAs, confetti)
    if (type === "bot" && !isRestored) {
      enhanceBotMessage(wrapper, text);
    }

    // Inline feedback for bot messages (not on restore, not on welcome)
    if (type === "bot" && !isRestored && chatId && userMsgCount > 0) {
      var fb = document.createElement("div");
      fb.className = "bj-feedback";
      fb.innerHTML = '<button data-vote="up" title="Util">\uD83D\uDC4D</button><button data-vote="down" title="No util">\uD83D\uDC4E</button>';
      fb.querySelectorAll("button").forEach(function (btn) {
        btn.onclick = function () {
          fb.querySelectorAll("button").forEach(function (b) { b.classList.remove("voted", "voted-down"); b.disabled = true; });
          btn.classList.add(btn.dataset.vote === "up" ? "voted" : "voted-down");
          fetch(FEEDBACK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId: chatId, sessionId: sessionId, vote: btn.dataset.vote })
          }).catch(function () {});
        };
      });
      wrapper.appendChild(fb);
    }

    chatBody.appendChild(wrapper);
    if (!isRestored) scrollBottom();
  }

  // ═══════════════════════════════════════
  // TYPING INDICATOR
  // ═══════════════════════════════════════
  var TYPING_PHRASES = [
    "Preparando tu respuesta...",
    "Cocinando tu respuesta \uD83C\uDF73",
    "Consultando la cocina...",
    "Un momento, voy a por la info \uD83C\uDF54",
    "Dame un sec...",
  ];

  function showTyping() {
    var phrase = TYPING_PHRASES[Math.floor(Math.random() * TYPING_PHRASES.length)];
    setHeaderStatus(phrase, true);
    var div = document.createElement("div");
    div.className = "bj-msg bj-msg-typing";
    div.id = "bj-typing";
    div.innerHTML = '<div class="bj-dots"><span></span><span></span><span></span></div>';
    chatBody.appendChild(div);
    scrollBottom();
  }

  function hideTyping() {
    setHeaderStatus(t("online"), false);
    var el = document.getElementById("bj-typing");
    if (el) el.remove();
    // Subtle notification sound (only if chat not focused)
    playNotifSound();
  }

  // Subtle pop sound using Web Audio API (no external file needed)
  function playNotifSound() {
    try {
      if (!isOpen) return; // only play if chat is open
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {} // Silently fail if audio not available
  }

  function scrollBottom() {
    setTimeout(function () {
      if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
    }, 60);
  }

  // ═══════════════════════════════════════
  // CONFETTI (on successful resolution)
  // ═══════════════════════════════════════
  function showConfetti() {
    var colors = ["#002855", "#F5E1A4", "#16a34a", "#2563eb", "#dc2626"];
    for (var i = 0; i < 20; i++) {
      var dot = document.createElement("div");
      dot.className = "bj-confetti";
      dot.style.background = colors[i % colors.length];
      dot.style.left = (10 + Math.random() * 80) + "%";
      dot.style.top = "40%";
      dot.style.animationDelay = (Math.random() * 0.5) + "s";
      dot.style.animationDuration = (0.8 + Math.random() * 0.8) + "s";
      chatBody.appendChild(dot);
      (function(el) { setTimeout(function() { el.remove(); }, 2000); })(dot);
    }
  }

  // Detect if bot response indicates successful resolution
  function isResolutionMessage(text) {
    return /registrado tu incidencia|incidencia.*registrad|tema resuelto|listo.*cualquier cosa|buen provecho|de nada.*aqui estamos/i.test(text);
  }

  // Detect if bot mentions a burger with link opportunity
  function enhanceBotMessage(wrapper, text) {
    // Add "Pedir" CTA if bot mentions ordering or a specific burger
    if (/burgerjazz\.com\/pide-ya|puedes pedirla|haz tu pedido/i.test(text)) {
      var cta = document.createElement("a");
      cta.className = "bj-order-cta";
      cta.href = "https://burgerjazz.com/pide-ya";
      cta.target = "_blank";
      cta.rel = "noopener";
      cta.textContent = "\uD83C\uDF54 Pedir ahora";
      wrapper.appendChild(cta);
    }
    // Confetti on resolution
    if (isResolutionMessage(text)) {
      setTimeout(showConfetti, 300);
    }
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
    clearInactivityTimer();
    document.getElementById("bj-chat-quick").innerHTML = "";
    isLoading = true;
    document.getElementById("bj-chat-send").disabled = true;
    showTyping();

    var apiMessages = messages.map(function (m) {
      return { role: m.role, content: m.content };
    });

    fetchWithRetry(apiMessages, 0);
  }

  // ═══════════════════════════════════════
  // STREAMING FETCH
  // ═══════════════════════════════════════
  function fetchStreaming(apiMessages) {
    var controller = null;
    var timeoutId = null;
    if (window.AbortController) {
      controller = new AbortController();
      timeoutId = setTimeout(function () { controller.abort(); }, 30000);
    }

    var fetchOpts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages, sessionId: sessionId, stream: true }),
    };
    if (controller) fetchOpts.signal = controller.signal;

    fetch(API_URL, fetchOpts)
      .then(function (r) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (!r.body || !r.body.getReader) {
          // Fallback: no streaming support in browser
          return r.json().then(function (data) {
            hideTyping();
            isLoading = false;
            document.getElementById("bj-chat-send").disabled = false;
            if (data.reply) addBotMessage(data.reply, data.quickReplies || null, data.chatId);
          });
        }

        hideTyping();
        // Create streaming bot message
        var ts = Date.now();
        var wrapper = document.createElement("div");
        wrapper.className = "bj-msg bj-msg-bot";
        wrapper.innerHTML = "";
        chatBody.appendChild(wrapper);
        scrollBottom();

        var fullText = "";
        var reader = r.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";

        function processStream() {
          reader.read().then(function (result) {
            if (result.done) {
              isLoading = false;
              document.getElementById("bj-chat-send").disabled = false;
              return;
            }
            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split("\n");
            buffer = lines.pop() || "";

            lines.forEach(function (line) {
              if (!line.startsWith("data: ")) return;
              try {
                var data = JSON.parse(line.slice(6));
                if (data.type === "text") {
                  fullText += data.text;
                  wrapper.innerHTML = parseMarkdown(escapeHTML(fullText));
                  scrollBottom();
                } else if (data.type === "fallback") {
                  fullText = data.text;
                  wrapper.innerHTML = parseMarkdown(escapeHTML(fullText));
                } else if (data.type === "done") {
                  // Add timestamp
                  var timeEl = document.createElement("div");
                  timeEl.className = "bj-msg-time";
                  timeEl.textContent = fmtTime(ts);
                  wrapper.appendChild(timeEl);
                  // Add inline feedback
                  if (data.chatId && userMsgCount > 0) {
                    var fb = document.createElement("div");
                    fb.className = "bj-feedback";
                    fb.innerHTML = '<button data-vote="up" title="Util">\uD83D\uDC4D</button><button data-vote="down" title="No util">\uD83D\uDC4E</button>';
                    fb.querySelectorAll("button").forEach(function (btn) {
                      btn.onclick = function () {
                        fb.querySelectorAll("button").forEach(function (b) { b.classList.remove("voted", "voted-down"); b.disabled = true; });
                        btn.classList.add(btn.dataset.vote === "up" ? "voted" : "voted-down");
                        fetch(FEEDBACK_URL, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ chatId: data.chatId, sessionId: sessionId, vote: btn.dataset.vote })
                        }).catch(function () {});
                      };
                    });
                    wrapper.appendChild(fb);
                  }
                  // Enhance (CTA, confetti)
                  enhanceBotMessage(wrapper, fullText);
                  // Save to messages array
                  messages.push({ role: "assistant", content: fullText, ts: ts });
                  saveSession();
                  // Quick replies
                  if (data.quickReplies && data.quickReplies.length) showQuickReplies(data.quickReplies);
                  checkConversationEnd(fullText);
                  isLoading = false;
                  document.getElementById("bj-chat-send").disabled = false;
                }
              } catch (e) {}
            });
            processStream();
          }).catch(function () {
            isLoading = false;
            document.getElementById("bj-chat-send").disabled = false;
            if (!fullText) {
              wrapper.innerHTML = escapeHTML(t("netError"));
            }
          });
        }
        processStream();
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        hideTyping();
        isLoading = false;
        document.getElementById("bj-chat-send").disabled = false;
        var msg = err && err.name === "AbortError" ? t("timeout") : t("netError");
        addBotMessage(msg);
      });
  }

  function fetchWithRetry(apiMessages, attempt) {
    // Use streaming if supported
    if (USE_STREAMING && window.ReadableStream) {
      return fetchStreaming(apiMessages);
    }

    var controller = null;
    var timeoutId = null;

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
          addBotMessage(data.reply, data.quickReplies || null, data.chatId);
          checkConversationEnd(data.reply);
        } else {
          addBotMessage(t("apiFail"));
        }
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);

        if (attempt < 1) {
          setTimeout(function () {
            fetchWithRetry(apiMessages, attempt + 1);
          }, 1500);
          return;
        }

        hideTyping();
        isLoading = false;
        document.getElementById("bj-chat-send").disabled = false;

        var msg = err && err.name === "AbortError" ? t("timeout") : t("netError");
        addBotMessage(msg);
      });
  }

  // ═══════════════════════════════════════
  // CONVERSATION END DETECTION
  // ═══════════════════════════════════════
  var _inactivityTimer = null;
  var INACTIVITY_DELAY = 90000; // 90 seconds

  // Patterns that indicate the bot has resolved/closed the conversation
  var END_PATTERNS_BOT = /\b(listo|resuelto|tema resuelto|cualquier cosa aqu[ií]|estamos aqu[ií]|lo dicho|buen provecho|a disfrutar|que aproveche|nos vemos|pasa buen|cuídate|disfruta|que vaya bien|de nada|no hay de qu[eé]|encantado de ayudar|me alegro de haberte ayudado|aqu[ií] estamos para lo que necesites|si necesitas algo m[áa]s|ha quedado registrad|he registrado tu incidencia)\b/i;

  // Patterns that indicate the user is saying goodbye/thanks
  var END_PATTERNS_USER = /\b(gracias|grax|thx|thanks|thank you|perfecto|genial|vale|ok|adi[oó]s|bye|hasta luego|chao|nos vemos|eso es todo|ya est[áa]|nada m[áa]s|era eso)\b/i;

  function checkConversationEnd(botReply) {
    if (hasRated || userMsgCount < 2) return;
    clearInactivityTimer();

    // Check if bot response signals resolution
    if (END_PATTERNS_BOT.test(botReply)) {
      // Show rating after a short delay so the user reads the message
      setTimeout(function () {
        if (!hasRated) showRating();
      }, 2500);
      return;
    }

    // Check if the last user message was a farewell/thanks
    var lastUser = messages.filter(function (m) { return m.role === "user"; }).pop();
    if (lastUser && END_PATTERNS_USER.test(lastUser.content)) {
      setTimeout(function () {
        if (!hasRated) showRating();
      }, 2000);
      return;
    }

    // Start inactivity timer — if no new messages in 90s, show rating
    startInactivityTimer();
  }

  function startInactivityTimer() {
    clearInactivityTimer();
    if (hasRated || userMsgCount < 2) return;
    _inactivityTimer = setTimeout(function () {
      if (!hasRated && userMsgCount >= 2 && isOpen) showRating();
    }, INACTIVITY_DELAY);
  }

  function clearInactivityTimer() {
    if (_inactivityTimer) { clearTimeout(_inactivityTimer); _inactivityTimer = null; }
  }

  // ═══════════════════════════════════════
  // RATING
  // ═══════════════════════════════════════
  var _ratingReminded = false;
  function showRating() {
    if (hasRated) return;
    // Add inline bot message asking for rating
    if (!_ratingReminded) {
      _ratingReminded = true;
      addBotMessage(t("rateAsk"));
    }
    var el = document.getElementById("bj-rating");
    var emojis = LANG === "en" ? [
      { emoji: "\uD83D\uDE21", val: 1, label: "Bad" },
      { emoji: "\uD83D\uDE15", val: 2, label: "Meh" },
      { emoji: "\uD83D\uDE10", val: 3, label: "OK" },
      { emoji: "\uD83D\uDE0A", val: 4, label: "Good" },
      { emoji: "\uD83E\uDD29", val: 5, label: "Great!" }
    ] : [
      { emoji: "\uD83D\uDE21", val: 1, label: "Mal" },
      { emoji: "\uD83D\uDE15", val: 2, label: "Bof" },
      { emoji: "\uD83D\uDE10", val: 3, label: "OK" },
      { emoji: "\uD83D\uDE0A", val: 4, label: "Bien" },
      { emoji: "\uD83E\uDD29", val: 5, label: "Top!" }
    ];
    el.innerHTML = '<div class="bj-rate-label">' + t("rateLabel") + '</div><div class="bj-rate-emojis">' +
      emojis.map(function (e) {
        return '<button class="bj-rate-btn" data-val="' + e.val + '" title="' + e.label + '">' + e.emoji + '<div style="font-size:9px;margin-top:2px;color:#6b7280">' + e.label + '</div></button>';
      }).join("") + '</div>';
    el.style.display = "block";
    el.style.animation = "bj-fade-in .4s ease";
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
          el.innerHTML = '<div class="bj-rate-thanks">' + t("rateThanks") + '</div>';
          setTimeout(function () { el.style.display = "none"; }, 3000);
        }, 600);
      };
    });
    scrollBottom();
  }

  // ═══════════════════════════════════════
  // PROACTIVE ENGAGEMENT
  // ═══════════════════════════════════════
  function getProactiveBubbleText() {
    var now = new Date();
    var hour = now.getHours();
    var day = now.getDay();
    // Jazz Days Wednesday
    if (day === 3 && hour >= 11 && hour < 22) return "Hoy es Jazz Day! 2x1 en burgers \uD83C\uDFB7";
    // Lunch
    if (hour >= 11 && hour < 14) return "Hambre? Te ayudo a elegir burger \uD83C\uDF54";
    // Dinner
    if (hour >= 18 && hour < 21) return "Hora de cenar? Echa un ojo a la carta \uD83C\uDF1F";
    // Weekend
    if ((day === 5 || day === 6) && hour >= 12 && hour < 22) return "Finde de burgers! Necesitas algo? \uD83C\uDF89";
    // Default
    return t("bubble");
  }

  function setupProactive() {
    if (sessionStorage.getItem("bj_greeted")) return;

    setTimeout(function () {
      if (isOpen) return;
      document.getElementById("bj-chat-badge").style.display = "flex";

      setTimeout(function () {
        if (isOpen) return;
        var bubble = document.getElementById("bj-chat-bubble");
        if (bubble) {
          bubble.textContent = getProactiveBubbleText();
          bubble.classList.add("show");
          sessionStorage.setItem("bj_greeted", "1");
          setTimeout(function () { bubble.classList.remove("show"); }, 8000);
        }
      }, 6000);
    }, 3500);
  }

  // ═══════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════
  function boot() {
    // Detect browser language
    LANG = detectBrowserLang();

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

    // Update header with open/closed status
    setHeaderStatus(t("online"), false);

    setupProactive();

    // Refresh open/closed status every 5 min
    setInterval(function () { setHeaderStatus(t("online"), false); }, 5 * 60 * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
