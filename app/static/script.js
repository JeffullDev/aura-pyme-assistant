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
  closed: "✅ Esta conversación ha finalizado. Inicia una nueva conversación para seguir escribiendo.",
  abandoned: "⌛ Esta conversación se cerró por inactividad. Inicia una nueva conversación para seguir escribiendo.",
};

const HUMAN_STATUSES = ["escalated", "assigned"];
const ENDED_STATUSES = ["closed", "abandoned"];

const messagesEl = document.getElementById("messages");
const typingIndicatorEl = document.getElementById("typing-indicator");
const escalationBannerEl = document.getElementById("escalation-banner");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("message-input");
const sendBtnEl = document.getElementById("send-btn");
const newConversationBtnEl = document.getElementById("new-conversation-btn");
const statusDotEl = document.getElementById("status-dot");
const statusTextEl = document.getElementById("status-text");

let pollTimer = null;
let lastPolledAt = null;
// Distinto de "sending" (deshabilitado momentaneamente mientras se envia un
// mensaje): esto deshabilita el input de forma persistente porque la sesion
// ya termino, y setSending no debe poder revertirlo por accidente al volver
// del finally de handleSubmit.
let conversationEnded = false;

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
  if (conversationEnded) return;
  inputEl.disabled = isSending;
  sendBtnEl.disabled = isSending;
}

function setOnlineIndicator(isOnline) {
  statusDotEl.classList.toggle("status-dot-offline", !isOnline);
  statusTextEl.textContent = isOnline ? "Asistente virtual · en línea" : "Conversación finalizada";
}

// Deshabilita el input de forma persistente y destaca "Nueva conversación"
// como la siguiente accion posible — a diferencia de setSending, esto no se
// revierte solo hasta que el cliente empieza una conversacion nueva.
function setConversationEnded(isEnded) {
  conversationEnded = isEnded;
  inputEl.disabled = isEnded;
  sendBtnEl.disabled = isEnded;
  inputEl.placeholder = isEnded ? "Esta conversación ha finalizado" : "Escribe tu mensaje...";
  newConversationBtnEl.classList.toggle("btn-new-conversation-highlight", isEnded);
  setOnlineIndicator(!isEnded);
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

      const { status, messages } = await response.json();
      messages.forEach((msg) => {
        lastPolledAt = msg.created_at;
        if (msg.role !== "agent") return;
        if (skipRemaining > 0) {
          skipRemaining -= 1;
          return;
        }
        appendMessage("agent", msg.content, { agentName: msg.tool_name });
      });

      // El poll trae el status real de la sesion: si el asesor la cierra (o
      // se auto-cierra por inactividad) mientras el cliente la tiene abierta,
      // hay que reflejarlo aqui mismo, no solo al enviar el siguiente mensaje.
      if (sessionId === getSessionId()) {
        setStatus(sessionId, status);
      }
    } catch (err) {
      // Silencioso: se reintenta en el siguiente tick.
    }
  }

  tick();
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
}

function setStatus(sessionId, status) {
  localStorage.setItem(STORAGE_KEYS.status, status);

  const isHuman = HUMAN_STATUSES.includes(status);
  const isEnded = ENDED_STATUSES.includes(status);

  escalationBannerEl.hidden = !(isHuman || isEnded);
  escalationBannerEl.classList.toggle("escalation-banner-ended", isEnded);
  escalationBannerEl.textContent = BANNER_TEXT[status] || "";

  setConversationEnded(isEnded);

  // Una vez terminada la sesion no llegaran mas mensajes: seguir consultando
  // no tiene sentido y solo mantendria vivo un timer sin proposito.
  if (isHuman) {
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

  const priorSessionId = getSessionId();
  appendMessage("user", message);
  inputEl.value = "";
  setSending(true);
  setTyping(true);

  try {
    const data = await sendMessage(message);
    // Si la sesion local estaba closed/abandoned (o se cerro en el servidor sin
    // que este cliente lo supiera todavia, p.ej. auto-cierre por inactividad
    // mientras el status local seguia en 'active'), el backend abre una sesion
    // nueva de forma transparente (ver comentario en handle_message de
    // agent_service.py). El hilo visible queda desincronizado si seguimos
    // mostrandolo como continuacion: hay que arrancarlo de cero.
    if (priorSessionId && data.session_id !== priorSessionId) {
      messagesEl.innerHTML = "";
      localStorage.removeItem(STORAGE_KEYS.messages);
      setConversationEnded(false);
      appendMessage("user", message);
    }
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
  setConversationEnded(false);
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
