/*
 * AURA — widget embebible.
 *
 * Uso: pegar en cualquier sitio, antes de </body>:
 *
 *   <script src="https://tu-dominio-aura.com/static/widget.js"
 *           data-business-id="tu-negocio"
 *           data-api="https://tu-dominio-aura.com"></script>
 *
 * Autocontenido y sin dependencias: todo el markup y el CSS del widget viven
 * dentro de un Shadow DOM propio, para que el CSS del sitio anfitrion no lo
 * deforme y el widget tampoco afecte al resto de la pagina.
 *
 * NOTA DE MANTENIMIENTO: la logica de conversacion (localStorage, polling,
 * indicador de "escribiendo", banner de escalamiento, saneo de texto del
 * asistente) esta intencionalmente duplicada de app/static/script.js. Viven
 * en documentos distintos (pagina completa vs. este Shadow DOM) y extraer un
 * modulo compartido complicaba mas de lo que simplificaba para este MVP. Si
 * cambias el comportamiento de la conversacion en uno, replica el cambio en
 * el otro.
 */
(function () {
  "use strict";

  const scriptEl = document.currentScript;
  if (!scriptEl) return;

  const config = {
    businessId: scriptEl.dataset.businessId || "default",
    apiBase: (scriptEl.dataset.api || window.location.origin).replace(/\/+$/, ""),
    businessName: scriptEl.dataset.businessName || "",
  };

  const STORAGE_PREFIX = `aura_widget_${config.businessId}_`;
  const STORAGE_KEYS = {
    sessionId: `${STORAGE_PREFIX}session_id`,
    userIdentifier: `${STORAGE_PREFIX}user_identifier`,
    messages: `${STORAGE_PREFIX}messages`,
    status: `${STORAGE_PREFIX}status`,
  };

  const POLL_INTERVAL_MS = 4000;

  const BANNER_TEXT = {
    escalated: "🙋 Un asesor humano se pondrá en contacto contigo pronto. Mientras tanto, puedes seguir escribiendo.",
    assigned: "🙋 Ya estás hablando con un asesor humano.",
  };

  const GREETING = config.businessName
    ? `¡Hola! Soy el asistente virtual de ${config.businessName}. ¿En qué puedo ayudarte hoy?`
    : "¡Hola! ¿En qué puedo ayudarte hoy?";

  let pollTimer = null;
  let lastPolledAt = null;

  // ---------- Shadow DOM: markup + estilos aislados ----------

  const WIDGET_CSS = `
    :host {
      all: initial;
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483000;
      display: flex;
      flex-direction: column-reverse;
      align-items: flex-end;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * {
      box-sizing: border-box;
    }
    .aura-bubble {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      border: none;
      background: #2563eb;
      color: white;
      cursor: pointer;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .aura-bubble:hover {
      background: #1d4ed8;
      transform: scale(1.05);
    }
    .aura-bubble-icon-close {
      display: none;
    }
    .aura-bubble.aura-bubble-open .aura-bubble-icon-chat {
      display: none;
    }
    .aura-bubble.aura-bubble-open .aura-bubble-icon-close {
      display: block;
    }
    .aura-panel {
      width: min(360px, calc(100vw - 40px));
      height: min(520px, 75vh);
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.22);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .aura-panel[hidden] {
      display: none;
    }
    .aura-header {
      background: #2563eb;
      color: white;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-shrink: 0;
    }
    .aura-header-info {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .aura-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      flex-shrink: 0;
    }
    .aura-header-title {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .aura-header-status {
      margin: 1px 0 0;
      font-size: 11px;
      opacity: 0.9;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .aura-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4ade80;
      display: inline-block;
    }
    .aura-new-btn {
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.35);
      color: white;
      font-size: 11px;
      padding: 5px 8px;
      border-radius: 7px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .aura-new-btn:hover {
      background: rgba(255, 255, 255, 0.28);
    }
    .aura-banner {
      background: #fff7ed;
      border-bottom: 1px solid #fb923c;
      color: #9a3412;
      font-size: 12px;
      padding: 8px 14px;
      text-align: center;
      flex-shrink: 0;
    }
    .aura-banner[hidden] {
      display: none;
    }
    .aura-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .aura-message {
      max-width: 82%;
      padding: 8px 12px;
      border-radius: 14px;
      font-size: 13px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .aura-message.user {
      align-self: flex-end;
      background: #2563eb;
      color: white;
      border-bottom-right-radius: 3px;
    }
    .aura-message.assistant {
      align-self: flex-start;
      background: #eef0f3;
      color: #1f2937;
      border-bottom-left-radius: 3px;
    }
    .aura-message.error {
      align-self: flex-start;
      background: #fef2f2;
      border: 1px solid #f87171;
      color: #991b1b;
      border-bottom-left-radius: 3px;
    }
    .aura-message.agent {
      align-self: flex-start;
      background: #ecfdf5;
      border: 1px solid #6ee7b7;
      color: #065f46;
      border-bottom-left-radius: 3px;
    }
    .aura-message-agent-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      opacity: 0.8;
      margin-bottom: 2px;
    }
    .aura-typing {
      display: flex;
      gap: 4px;
      padding: 0 14px 8px;
      flex-shrink: 0;
    }
    .aura-typing[hidden] {
      display: none;
    }
    .aura-typing span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #6b7280;
      opacity: 0.5;
      animation: aura-typing-bounce 1.2s infinite ease-in-out;
    }
    .aura-typing span:nth-child(2) {
      animation-delay: 0.15s;
    }
    .aura-typing span:nth-child(3) {
      animation-delay: 0.3s;
    }
    @keyframes aura-typing-bounce {
      0%, 60%, 100% {
        transform: translateY(0);
        opacity: 0.5;
      }
      30% {
        transform: translateY(-3px);
        opacity: 1;
      }
    }
    .aura-form {
      display: flex;
      gap: 6px;
      padding: 10px;
      border-top: 1px solid #e5e7eb;
      flex-shrink: 0;
    }
    .aura-input {
      flex: 1;
      border: 1px solid #d1d5db;
      border-radius: 18px;
      padding: 8px 12px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
      min-width: 0;
    }
    .aura-input:focus {
      border-color: #2563eb;
    }
    .aura-send {
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 18px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .aura-send:hover {
      background: #1d4ed8;
    }
    .aura-send:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `;

  const WIDGET_HTML = `
    <div class="aura-panel" id="aura-panel" hidden>
      <header class="aura-header">
        <div class="aura-header-info">
          <div class="aura-avatar">💬</div>
          <div>
            <div class="aura-header-title">${escapeHtml(config.businessName || "Asistente virtual")}</div>
            <p class="aura-header-status"><span class="aura-status-dot"></span>en línea</p>
          </div>
        </div>
        <button id="aura-new-btn" class="aura-new-btn" type="button">Nueva conversación</button>
      </header>
      <div id="aura-banner" class="aura-banner" hidden></div>
      <main id="aura-messages" class="aura-messages"></main>
      <div id="aura-typing" class="aura-typing" hidden><span></span><span></span><span></span></div>
      <form id="aura-form" class="aura-form">
        <input id="aura-input" class="aura-input" type="text" placeholder="Escribe tu mensaje..." autocomplete="off" maxlength="1000" />
        <button id="aura-send" class="aura-send" type="submit">Enviar</button>
      </form>
    </div>
    <button id="aura-bubble" class="aura-bubble" type="button" aria-label="Abrir chat">
      <span class="aura-bubble-icon-chat">💬</span>
      <span class="aura-bubble-icon-close">✕</span>
    </button>
  `;

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const host = document.createElement("div");
  host.id = "aura-widget-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = WIDGET_CSS;
  shadow.appendChild(styleEl);

  const rootEl = document.createElement("div");
  rootEl.innerHTML = WIDGET_HTML;
  while (rootEl.firstChild) {
    shadow.appendChild(rootEl.firstChild);
  }

  const bubbleEl = shadow.getElementById("aura-bubble");
  const panelEl = shadow.getElementById("aura-panel");
  const bannerEl = shadow.getElementById("aura-banner");
  const messagesEl = shadow.getElementById("aura-messages");
  const typingEl = shadow.getElementById("aura-typing");
  const formEl = shadow.getElementById("aura-form");
  const inputEl = shadow.getElementById("aura-input");
  const sendBtnEl = shadow.getElementById("aura-send");
  const newBtnEl = shadow.getElementById("aura-new-btn");

  // ---------- Estado del panel (abierto/cerrado) ----------

  function openPanel() {
    panelEl.hidden = false;
    bubbleEl.classList.add("aura-bubble-open");
    bubbleEl.setAttribute("aria-label", "Cerrar chat");
    messagesEl.scrollTop = messagesEl.scrollHeight;
    inputEl.focus();
  }

  function closePanel() {
    panelEl.hidden = true;
    bubbleEl.classList.remove("aura-bubble-open");
    bubbleEl.setAttribute("aria-label", "Abrir chat");
  }

  bubbleEl.addEventListener("click", () => {
    if (panelEl.hidden) {
      openPanel();
    } else {
      closePanel();
    }
  });

  // ---------- Logica de conversacion (misma que script.js) ----------

  function getOrCreateUserIdentifier() {
    let userIdentifier = localStorage.getItem(STORAGE_KEYS.userIdentifier);
    if (!userIdentifier) {
      userIdentifier = `web-${crypto.randomUUID()}`;
      localStorage.setItem(STORAGE_KEYS.userIdentifier, userIdentifier);
    }
    return userIdentifier;
  }

  function getSessionId() {
    return localStorage.getItem(STORAGE_KEYS.sessionId);
  }

  function setSessionId(sessionId) {
    localStorage.setItem(STORAGE_KEYS.sessionId, sessionId);
  }

  function getStoredMessages() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.messages)) || [];
    } catch {
      return [];
    }
  }

  function sanitizeAssistantText(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/(^|\n)\s*[-*]\s+/g, "$1")
      .replace(/(^|\n)\s*\d+\.\s+/g, "$1")
      .replace(/(^|\n)#{1,6}\s*/g, "$1");
  }

  function renderMessage(role, text, { agentName } = {}) {
    const displayText = role === "assistant" ? sanitizeAssistantText(text) : text;
    const bubble = document.createElement("div");
    bubble.className = `aura-message ${role}`;

    if (role === "agent") {
      const label = document.createElement("div");
      label.className = "aura-message-agent-label";
      label.textContent = agentName || "Asesor";
      bubble.appendChild(label);
      const body = document.createElement("div");
      body.textContent = displayText;
      bubble.appendChild(body);
    } else {
      bubble.textContent = displayText;
    }

    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function appendMessage(role, text, { persist = true, agentName } = {}) {
    const bubble = renderMessage(role, text, { agentName });
    if (persist) {
      const stored = getStoredMessages();
      stored.push({ role, text, agentName });
      localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(stored));
    }
    return bubble;
  }

  function setTyping(isTyping) {
    typingEl.hidden = !isTyping;
    if (isTyping) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function setSending(isSending) {
    inputEl.disabled = isSending;
    sendBtnEl.disabled = isSending;
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling(sessionId) {
    if (pollTimer) return;

    let skipRemaining = getStoredMessages().filter((m) => m.role === "agent").length;
    lastPolledAt = null;

    async function tick() {
      try {
        const url = lastPolledAt
          ? `${config.apiBase}/chat/${sessionId}/messages?since=${encodeURIComponent(lastPolledAt)}`
          : `${config.apiBase}/chat/${sessionId}/messages`;
        const response = await fetch(url);
        if (!response.ok) return;

        const messages = await response.json();
        messages.forEach((msg) => {
          lastPolledAt = msg.created_at;
          if (msg.role !== "agent") return;
          if (skipRemaining > 0) {
            skipRemaining -= 1;
            return;
          }
          appendMessage("agent", msg.content, { agentName: msg.tool_name });
        });
      } catch {
        // Silencioso: se reintenta en el siguiente tick.
      }
    }

    tick();
    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  }

  function setStatus(sessionId, status) {
    localStorage.setItem(STORAGE_KEYS.status, status);
    const showBanner = status === "escalated" || status === "assigned";
    bannerEl.hidden = !showBanner;
    bannerEl.textContent = BANNER_TEXT[status] || "";

    if (showBanner) {
      startPolling(sessionId);
    } else {
      stopPolling();
    }
  }

  async function sendMessage(message) {
    const response = await fetch(`${config.apiBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: getSessionId(),
        user_identifier: getOrCreateUserIdentifier(),
        message,
      }),
    });

    if (!response.ok) {
      throw new Error(`El servidor respondió con estado ${response.status}`);
    }

    return response.json();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const message = inputEl.value.trim();
    if (!message) return;

    appendMessage("user", message);
    inputEl.value = "";
    setSending(true);
    setTyping(true);

    try {
      const data = await sendMessage(message);
      setSessionId(data.session_id);
      if (data.reply) {
        appendMessage("assistant", data.reply);
      }
      setStatus(data.session_id, data.status);
    } catch {
      appendMessage(
        "error",
        "No pudimos enviar tu mensaje. Revisa tu conexión e intenta de nuevo.",
        { persist: false }
      );
    } finally {
      setTyping(false);
      setSending(false);
      inputEl.focus();
    }
  }

  function startNewConversation() {
    stopPolling();
    localStorage.removeItem(STORAGE_KEYS.sessionId);
    localStorage.removeItem(STORAGE_KEYS.messages);
    localStorage.removeItem(STORAGE_KEYS.status);
    messagesEl.innerHTML = "";
    bannerEl.hidden = true;
    appendMessage("assistant", GREETING);
  }

  function restoreConversation() {
    const stored = getStoredMessages();
    stored.forEach(({ role, text, agentName }) => renderMessage(role, text, { agentName }));
    const status = localStorage.getItem(STORAGE_KEYS.status) || "active";
    setStatus(getSessionId(), status);
  }

  formEl.addEventListener("submit", handleSubmit);
  newBtnEl.addEventListener("click", startNewConversation);

  if (!getSessionId()) {
    startNewConversation();
  } else {
    restoreConversation();
  }
})();
