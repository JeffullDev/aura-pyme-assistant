const STORAGE_KEYS = {
  sessionId: "aura_session_id",
  userIdentifier: "aura_user_identifier",
  messages: "aura_messages",
  escalated: "aura_escalated",
};

const messagesEl = document.getElementById("messages");
const typingIndicatorEl = document.getElementById("typing-indicator");
const escalationBannerEl = document.getElementById("escalation-banner");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("message-input");
const sendBtnEl = document.getElementById("send-btn");
const newConversationBtnEl = document.getElementById("new-conversation-btn");

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

function renderMessage(role, text) {
  const displayText = role === "assistant" ? sanitizeAssistantText(text) : text;
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = displayText;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

// role "error" es solo visual (fallos de red) y no se persiste ni se manda a Claude.
function appendMessage(role, text, { persist = true } = {}) {
  const bubble = renderMessage(role, text);
  if (persist) {
    const stored = getStoredMessages();
    stored.push({ role, text });
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

function setEscalated(isEscalated) {
  escalationBannerEl.hidden = !isEscalated;
  localStorage.setItem(STORAGE_KEYS.escalated, isEscalated ? "1" : "0");
}

function setSending(isSending) {
  inputEl.disabled = isSending;
  sendBtnEl.disabled = isSending;
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
    appendMessage("assistant", data.reply);
    setEscalated(data.status === "escalated");
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
  localStorage.removeItem(STORAGE_KEYS.sessionId);
  localStorage.removeItem(STORAGE_KEYS.messages);
  localStorage.removeItem(STORAGE_KEYS.escalated);
  messagesEl.innerHTML = "";
  setEscalated(false);
  appendMessage(
    "assistant",
    "¡Hola! Soy el asistente virtual de El Tornillo Feliz. ¿En qué puedo ayudarte hoy?"
  );
}

function restoreConversation() {
  const stored = getStoredMessages();
  stored.forEach(({ role, text }) => renderMessage(role, text));
  setEscalated(localStorage.getItem(STORAGE_KEYS.escalated) === "1");
}

formEl.addEventListener("submit", handleSubmit);
newConversationBtnEl.addEventListener("click", startNewConversation);

if (!getSessionId()) {
  startNewConversation();
} else {
  restoreConversation();
}
