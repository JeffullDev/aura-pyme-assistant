const STATUS_LABELS = {
  active: "Activa",
  escalated: "Escalada",
  closed: "Cerrada",
};

const ROLE_LABELS = {
  user: "Cliente",
  assistant: "Asistente",
  tool: "Herramienta",
};

const sessionsListEl = document.getElementById("sessions-list");
const sessionsCountEl = document.getElementById("sessions-count");
const threadViewEl = document.getElementById("thread-view");
const filtersEl = document.getElementById("status-filters");

let currentStatus = "";
let selectedSessionId = null;

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
    const label = msg.role === "tool" ? `${ROLE_LABELS.tool} · ${msg.tool_name}` : ROLE_LABELS[msg.role] || msg.role;
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

async function selectSession(sessionId) {
  selectedSessionId = sessionId;
  document.querySelectorAll(".session-row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.sessionId === sessionId);
  });
  threadViewEl.innerHTML = '<p class="admin-empty">Cargando hilo...</p>';

  try {
    const messages = await fetchJson(`/admin/sessions/${sessionId}/messages`);
    renderThread(messages);
  } catch (err) {
    threadViewEl.innerHTML = '<p class="admin-empty admin-error">No se pudo cargar el hilo de la conversación.</p>';
  }
}

filtersEl.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-btn");
  if (!button) return;

  document.querySelectorAll(".filter-btn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");
  currentStatus = button.dataset.status;
  loadSessions();
});

loadStats();
loadSessions();
