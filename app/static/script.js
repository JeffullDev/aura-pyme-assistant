const STORAGE_KEYS = {
  sessionId: "aura_session_id",
  userIdentifier: "aura_user_identifier",
  messages: "aura_messages",
  status: "aura_status",
};

const POLL_INTERVAL_MS = 4000;

const BANNER_TEXT = {
  escalated: "🙋 Un asesor humano se pondrá en contacto contigo pronto. Mientras tanto, puedes seguir escribiendo.",
  assigned: "🙋 Ya estás hablando con un asesor humano.",
};

const messagesEl = document.getElementById("messages");
const typingIndicatorEl = document.getElementById("typing-indicator");
const escalationBannerEl = document.getElementById("escalation-banner");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("message-input");
const sendBtnEl = document.getElementById("send-btn");
const newConversationBtnEl = document.getElementById("new-conversation-btn");

let pollTimer = null;
let lastPolledAt = null;

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

// Red de seguridad: el system prompt le pide a Claude texto plano sin Markdown,
// pero por si se le escapa algun simbolo, lo limpiamos antes de mostrarlo.
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
  bubble.className = `message ${role}`;

  if (role === "agent") {
    const label = document.createElement("div");
    label.className = "message-agent-label";
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

// role "error" es solo visual (fallos de red) y no se persiste ni se manda a Claude.
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
  typingIndicatorEl.hidden = !isTyping;
  if (isTyping) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function setSending(isSending) {
  inputEl.disabled = isSending;
  sendBtnEl.disabled = isSending;
}

// Mientras un humano tiene la conversacion (escalated/assigned), el cliente
// hace polling de mensajes nuevos (respuestas del asesor). Al volver a
// active/closed, el polling se detiene.
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(sessionId) {
  if (pollTimer) return;

  // Al reconectar (recarga de pagina) no sabemos el timestamp exacto del
  // ultimo mensaje mostrado, asi que el primer tick trae todo el historial
  // publico de la sesion y se salta los mensajes role='agent' que ya estaban
  // en el cache local, para no duplicarlos.
  let skipRemaining = getStoredMessages().filter((m) => m.role === "agent").length;
  lastPolledAt = null;

  async function tick() {
    try {
      const url = lastPolledAt
        ? `/chat/${sessionId}/messages?since=${encodeURIComponent(lastPolledAt)}`
        : `/chat/${sessionId}/messages`;
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
    } catch (err) {
      // Silencioso: se reintenta en el siguiente tick.
    }
  }

  tick();
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
}

function setStatus(sessionId, status) {
  localStorage.setItem(STORAGE_KEYS.status, status);
  const showBanner = status === "escalated" || status === "assigned";
  escalationBannerEl.hidden = !showBanner;
  escalationBannerEl.textContent = BANNER_TEXT[status] || "";

  if (showBanner) {
    startPolling(sessionId);
  } else {
    stopPolling();
  }
}

async function sendMessage(message) {
  const response = await fetch("/chat", {
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
    // reply es null cuando el bot esta suprimido (sesion escalated/assigned):
    // no se renderiza una burbuja vacia del asistente en ese caso.
    if (data.reply) {
      appendMessage("assistant", data.reply);
    }
    setStatus(data.session_id, data.status);
  } catch (err) {
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
  escalationBannerEl.hidden = true;
  appendMessage(
    "assistant",
    "¡Hola! Soy el asistente virtual de El Tornillo Feliz. ¿En qué puedo ayudarte hoy?"
  );
}

function restoreConversation() {
  const stored = getStoredMessages();
  stored.forEach(({ role, text, agentName }) => renderMessage(role, text, { agentName }));
  const status = localStorage.getItem(STORAGE_KEYS.status) || "active";
  setStatus(getSessionId(), status);
}

formEl.addEventListener("submit", handleSubmit);
newConversationBtnEl.addEventListener("click", startNewConversation);

if (!getSessionId()) {
  startNewConversation();
} else {
  restoreConversation();
}
