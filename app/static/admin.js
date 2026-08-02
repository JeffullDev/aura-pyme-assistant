const STATUS_LABELS = {
  active: "Activa",
  escalated: "Escalada",
  assigned: "Asignada",
  closed: "Cerrada",
};

const ROLE_LABELS = {
  user: "Cliente",
  assistant: "Asistente",
  tool: "Herramienta",
  agent: "Asesor",
};

const ADMIN_AGENT_NAME_KEY = "aura_admin_agent_name";

const sessionsListEl = document.getElementById("sessions-list");
const sessionsCountEl = document.getElementById("sessions-count");
const threadViewEl = document.getElementById("thread-view");
const filtersEl = document.getElementById("status-filters");
const agentNameInputEl = document.getElementById("agent-name-input");
const handoffActionsEl = document.getElementById("handoff-actions");
const takeBtnEl = document.getElementById("take-btn");
const returnBtnEl = document.getElementById("return-btn");
const closeBtnEl = document.getElementById("close-btn");
const replyFormEl = document.getElementById("reply-form");
const replyInputEl = document.getElementById("reply-input");

let currentStatus = "";
let selectedSessionId = null;
let sessionsById = {};

function formatDate(isoString) {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatCost(value) {
  return `$${(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

function formatTokens(value) {
  return (value ?? 0).toLocaleString("es-CO");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} respondió con estado ${response.status}`);
  }
  return response.json();
}

function renderSessions(sessions) {
  sessionsById = {};
  sessions.forEach((session) => {
    sessionsById[session.id] = session;
  });

  sessionsCountEl.textContent = `${sessions.length} sesión${sessions.length === 1 ? "" : "es"}`;

  if (sessions.length === 0) {
    sessionsListEl.innerHTML = '<p class="admin-empty">No hay sesiones con este filtro.</p>';
    return;
  }

  sessionsListEl.innerHTML = "";
  sessions.forEach((session) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "session-row";
    row.dataset.sessionId = session.id;
    if (session.id === selectedSessionId) {
      row.classList.add("selected");
    }

    row.innerHTML = `
      <div class="session-row-main">
        <span class="session-user">${escapeHtml(session.user_identifier)}</span>
        <span class="status-badge status-${session.status}">${STATUS_LABELS[session.status] || session.status}</span>
      </div>
      <div class="session-row-meta">
        <span>${formatDate(session.started_at)}</span>
        <span>${session.message_count} mensaje${session.message_count === 1 ? "" : "s"}</span>
        <span class="session-cost">${formatCost(session.estimated_cost)}</span>
      </div>
    `;

    row.addEventListener("click", () => selectSession(session.id));
    sessionsListEl.appendChild(row);
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

function formatJson(value) {
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function renderThread(messages) {
  if (messages.length === 0) {
    threadViewEl.innerHTML = '<p class="admin-empty">Esta sesión no tiene mensajes.</p>';
    return;
  }

  threadViewEl.innerHTML = "";
  messages.forEach((msg) => {
    const entry = document.createElement("div");
    entry.className = `thread-entry thread-entry-${msg.role}`;

    const header = document.createElement("div");
    header.className = "thread-entry-header";
    let label = ROLE_LABELS[msg.role] || msg.role;
    if (msg.role === "tool") {
      label = `${ROLE_LABELS.tool} · ${msg.tool_name}`;
    } else if (msg.role === "agent" && msg.tool_name) {
      label = `${ROLE_LABELS.agent} · ${msg.tool_name}`;
    }
    header.innerHTML = `<span class="thread-entry-role">${escapeHtml(label)}</span><span class="thread-entry-time">${formatDate(msg.created_at)}</span>`;
    entry.appendChild(header);

    if (msg.role === "tool") {
      if (msg.tool_input !== null) {
        entry.appendChild(buildJsonBlock("Input", msg.tool_input));
      }
      if (msg.tool_output !== null) {
        entry.appendChild(buildJsonBlock("Output", msg.tool_output));
      }
    } else if (msg.content) {
      const content = document.createElement("p");
      content.className = "thread-entry-content";
      content.textContent = msg.content;
      entry.appendChild(content);
    }

    threadViewEl.appendChild(entry);
  });

  threadViewEl.scrollTop = threadViewEl.scrollHeight;
}

function buildJsonBlock(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "json-block";
  const title = document.createElement("span");
  title.className = "json-block-label";
  title.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = formatJson(value);
  wrapper.appendChild(title);
  wrapper.appendChild(pre);
  return wrapper;
}

async function loadStats() {
  try {
    const stats = await fetchJson("/admin/stats");
    document.getElementById("metric-total-conversations").textContent = formatTokens(stats.total_conversations);
    document.getElementById("metric-total-tokens").textContent = formatTokens(stats.total_tokens);
    document.getElementById("metric-total-cost").textContent = formatCost(stats.total_estimated_cost);
    document.getElementById("metric-avg-tokens").textContent = formatTokens(Math.round(stats.avg_tokens_per_conversation));
  } catch (err) {
    document.querySelectorAll("#admin-metrics .metric-value").forEach((el) => {
      el.textContent = "—";
    });
  }
}

async function loadSessions() {
  sessionsListEl.innerHTML = '<p class="admin-empty">Cargando sesiones...</p>';
  try {
    const url = currentStatus ? `/admin/sessions?status=${currentStatus}` : "/admin/sessions";
    const sessions = await fetchJson(url);
    renderSessions(sessions);
  } catch (err) {
    sessionsListEl.innerHTML = '<p class="admin-empty admin-error">No se pudieron cargar las sesiones.</p>';
  }
}

function updateHandoffControls() {
  const session = sessionsById[selectedSessionId];
  if (!session) {
    handoffActionsEl.hidden = true;
    replyFormEl.hidden = true;
    return;
  }

  const isAssigned = session.status === "assigned";
  const isClosed = session.status === "closed";

  handoffActionsEl.hidden = false;
  takeBtnEl.hidden = isAssigned || isClosed;
  returnBtnEl.hidden = !isAssigned;
  closeBtnEl.hidden = isClosed;
  replyFormEl.hidden = !isAssigned;
}

async function selectSession(sessionId) {
  selectedSessionId = sessionId;
  document.querySelectorAll(".session-row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.sessionId === sessionId);
  });
  threadViewEl.innerHTML = '<p class="admin-empty">Cargando hilo...</p>';
  updateHandoffControls();

  try {
    const messages = await fetchJson(`/admin/sessions/${sessionId}/messages`);
    renderThread(messages);
  } catch (err) {
    threadViewEl.innerHTML = '<p class="admin-empty admin-error">No se pudo cargar el hilo de la conversación.</p>';
  }
}

async function postJson(url, body) {
  const options = { method: "POST" };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail || `${url} respondió con estado ${response.status}`);
  }
  return response.json();
}

async function refreshAfterAction() {
  await loadSessions();
  if (selectedSessionId) {
    await selectSession(selectedSessionId);
  }
}

function getAgentName() {
  const name = agentNameInputEl.value.trim();
  if (!name) {
    alert("Escribe tu nombre antes de tomar una conversación.");
    agentNameInputEl.focus();
    return null;
  }
  localStorage.setItem(ADMIN_AGENT_NAME_KEY, name);
  return name;
}

takeBtnEl.addEventListener("click", async () => {
  const agentName = getAgentName();
  if (!agentName || !selectedSessionId) return;
  try {
    await postJson(`/admin/sessions/${selectedSessionId}/take`, { agent_name: agentName });
    await refreshAfterAction();
  } catch (err) {
    alert(err.message);
  }
});

returnBtnEl.addEventListener("click", async () => {
  if (!selectedSessionId) return;
  try {
    await postJson(`/admin/sessions/${selectedSessionId}/return-to-bot`);
    await refreshAfterAction();
  } catch (err) {
    alert(err.message);
  }
});

closeBtnEl.addEventListener("click", async () => {
  if (!selectedSessionId) return;
  if (!confirm("¿Cerrar esta conversación?")) return;
  try {
    await postJson(`/admin/sessions/${selectedSessionId}/close`);
    await refreshAfterAction();
  } catch (err) {
    alert(err.message);
  }
});

replyFormEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = replyInputEl.value.trim();
  if (!message || !selectedSessionId) return;
  try {
    await postJson(`/admin/sessions/${selectedSessionId}/reply`, { message });
    replyInputEl.value = "";
    await refreshAfterAction();
  } catch (err) {
    alert(err.message);
  }
});

filtersEl.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-btn");
  if (!button) return;

  document.querySelectorAll(".filter-btn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");
  currentStatus = button.dataset.status;
  loadSessions();
});

agentNameInputEl.value = localStorage.getItem(ADMIN_AGENT_NAME_KEY) || "";

loadStats();
loadSessions();
