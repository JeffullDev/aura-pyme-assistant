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

const ORDER_STATUS_LABELS = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  in_transit: "En camino",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

// Refleja app/api/admin.py::ORDER_STATUS_TRANSITIONS: solo botones de avance
// validos aparecen en cada tarjeta de pedido.
const ORDER_STATUS_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["in_transit", "cancelled"],
  in_transit: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
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
const conversationsQueueBadgeEl = document.getElementById("conversations-queue-badge");
const queueFilterBadgeEl = document.getElementById("queue-filter-badge");

const tabButtonsEl = document.querySelectorAll(".tab-btn");
const adminViewsEl = document.querySelectorAll(".admin-view");

const kpiRevenueEl = document.getElementById("kpi-revenue");
const kpiOrdersTotalEl = document.getElementById("kpi-orders-total");
const kpiConversionEl = document.getElementById("kpi-conversion");
const kpiAvgTicketEl = document.getElementById("kpi-avg-ticket");
const kpiConversationsTotalEl = document.getElementById("kpi-conversations-total");
const kpiEscalatedEl = document.getElementById("kpi-escalated");
const kpiTokenCostEl = document.getElementById("kpi-token-cost");
const kpiCostVsRevenueEl = document.getElementById("kpi-cost-vs-revenue");

const ordersFiltersEl = document.getElementById("orders-filters");
const ordersBoardEl = document.getElementById("orders-board");

const inventorySummaryEl = document.getElementById("inventory-summary");
const inventoryBodyEl = document.getElementById("inventory-body");
const inventoryTableEl = document.getElementById("inventory-table");

let currentStatus = "";
let currentOrderStatus = "";
let selectedSessionId = null;
let sessionsById = {};
let threadPollTimer = null;
let inventoryItems = [];
let inventorySort = { key: "name", desc: false };

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

// Los pedidos se cobran en pesos (COP); el costo de tokens se factura en
// dolares (formatCost). Nunca se mezclan como si fueran la misma unidad.
function formatCOP(value) {
  return `$${Math.round(value ?? 0).toLocaleString("es-CO")}`;
}

function formatPercent(value) {
  return `${(value ?? 0).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
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

function switchAdminView(view) {
  tabButtonsEl.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  adminViewsEl.forEach((section) => {
    section.hidden = section.id !== `view-${view}`;
  });
  if (view === "resumen") loadSummary();
  if (view === "orders") loadOrders();
  if (view === "inventory") loadInventory();
  if (view === "conversations") {
    loadSessions();
    startThreadPollingIfAssigned();
  } else {
    stopThreadPolling();
  }
}

tabButtonsEl.forEach((btn) => {
  btn.addEventListener("click", () => switchAdminView(btn.dataset.view));
});

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

async function loadSummary() {
  try {
    const stats = await fetchJson("/admin/stats");
    kpiRevenueEl.textContent = formatCOP(stats.revenue_total);
    kpiOrdersTotalEl.textContent = formatTokens(stats.total_orders);
    kpiConversionEl.textContent = `Tasa de conversión: ${formatPercent(stats.conversion_rate)}`;
    kpiAvgTicketEl.textContent = formatCOP(stats.avg_ticket);
    kpiConversationsTotalEl.textContent = formatTokens(stats.total_conversations);
    kpiEscalatedEl.textContent = `${formatTokens(stats.escalated_conversations)} escalada${stats.escalated_conversations === 1 ? "" : "s"} a un humano`;
    kpiTokenCostEl.textContent = formatCost(stats.total_estimated_cost);
    kpiCostVsRevenueEl.textContent = `Generó ${formatCOP(stats.revenue_total)} en pedidos — costó ${formatCost(stats.total_estimated_cost)} en tokens (USD)`;
  } catch (err) {
    document.querySelectorAll("#view-resumen .kpi-value").forEach((el) => {
      el.textContent = "—";
    });
  }
}

async function refreshQueueBadge() {
  try {
    const escalated = await fetchJson("/admin/sessions?status=escalated");
    const count = escalated.length;
    [conversationsQueueBadgeEl, queueFilterBadgeEl].forEach((el) => {
      el.textContent = String(count);
      el.hidden = count === 0;
    });
  } catch (err) {
    // Silencioso: el badge simplemente no se actualiza en este ciclo.
  }
}

function overdueOrder(order) {
  if (order.status === "delivered" || order.status === "cancelled") return false;
  return new Date(order.estimated_delivery_at).getTime() < Date.now();
}

function renderOrders(orders) {
  if (orders.length === 0) {
    ordersBoardEl.innerHTML = '<p class="admin-empty">No hay pedidos con este filtro.</p>';
    return;
  }

  ordersBoardEl.innerHTML = "";
  orders.forEach((order) => {
    const card = document.createElement("article");
    card.className = "order-card";

    const itemsHtml = order.items
      .map((item) => `<li>${item.quantity}× ${escapeHtml(item.product_name)} — ${formatCOP(item.subtotal)}</li>`)
      .join("");

    const overdue = overdueOrder(order);
    const etaClass = overdue ? "order-eta order-eta-overdue" : "order-eta";
    const etaLabel = overdue ? "Hora estimada superada" : "Entrega estimada";

    const actions = (ORDER_STATUS_TRANSITIONS[order.status] || [])
      .map((next) => {
        const secondary = next === "cancelled" ? " btn-secondary" : "";
        return `<button type="button" class="btn-handoff${secondary}" data-order-id="${order.id}" data-next-status="${next}">${ORDER_STATUS_LABELS[next]}</button>`;
      })
      .join("");

    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-reference">#${order.id.slice(0, 8)}</span>
        <span class="status-badge status-${order.status}">${ORDER_STATUS_LABELS[order.status] || order.status}</span>
      </div>
      <div class="order-customer">
        <strong>${escapeHtml(order.customer_name)}</strong>
        <span>${escapeHtml(order.delivery_address)}</span>
      </div>
      <ul class="order-items-list">${itemsHtml}</ul>
      <div class="order-card-footer">
        <span class="order-total">${formatCOP(order.total)}</span>
        <span class="${etaClass}">${etaLabel}: ${formatDate(order.estimated_delivery_at)}</span>
      </div>
      ${actions ? `<div class="order-actions">${actions}</div>` : ""}
    `;

    ordersBoardEl.appendChild(card);
  });
}

async function loadOrders() {
  ordersBoardEl.innerHTML = '<p class="admin-empty">Cargando pedidos...</p>';
  try {
    const url = currentOrderStatus ? `/admin/orders?status=${currentOrderStatus}` : "/admin/orders";
    const orders = await fetchJson(url);
    renderOrders(orders);
  } catch (err) {
    ordersBoardEl.innerHTML = '<p class="admin-empty admin-error">No se pudieron cargar los pedidos.</p>';
  }
}

ordersFiltersEl.addEventListener("click", (event) => {
  const button = event.target.closest(".filter-btn");
  if (!button) return;

  ordersFiltersEl.querySelectorAll(".filter-btn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");
  currentOrderStatus = button.dataset.orderStatus;
  loadOrders();
});

ordersBoardEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-order-id]");
  if (!button) return;
  const { orderId, nextStatus } = button.dataset;
  try {
    await postJson(`/admin/orders/${orderId}/status`, { status: nextStatus });
    await loadOrders();
  } catch (err) {
    alert(err.message);
  }
});

function inventoryAlertClass(stock) {
  if (stock === 0) return "inventory-row-out";
  if (stock <= 4) return "inventory-row-low";
  return "";
}

function renderInventory() {
  const outCount = inventoryItems.filter((item) => item.stock === 0).length;
  const lowCount = inventoryItems.filter((item) => item.stock > 0 && item.stock <= 4).length;
  inventorySummaryEl.innerHTML = `
    <span class="status-badge status-error">${outCount} producto${outCount === 1 ? "" : "s"} agotado${outCount === 1 ? "" : "s"}</span>
    <span class="status-badge status-escalated">${lowCount} con stock bajo</span>
  `;

  const sorted = [...inventoryItems].sort((a, b) => {
    const { key, desc } = inventorySort;
    const va = a[key];
    const vb = b[key];
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return desc ? -cmp : cmp;
  });

  if (sorted.length === 0) {
    inventoryBodyEl.innerHTML = '<tr><td colspan="4" class="admin-empty">No hay productos en el catálogo.</td></tr>';
    return;
  }

  inventoryBodyEl.innerHTML = "";
  sorted.forEach((item) => {
    const row = document.createElement("tr");
    row.className = inventoryAlertClass(item.stock);
    row.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category || "—")}</td>
      <td>${formatCOP(item.price)}</td>
      <td>${item.stock}</td>
    `;
    inventoryBodyEl.appendChild(row);
  });
}

async function loadInventory() {
  inventoryBodyEl.innerHTML = '<tr><td colspan="4" class="admin-empty">Cargando inventario...</td></tr>';
  try {
    inventoryItems = await fetchJson("/admin/inventory");
    renderInventory();
  } catch (err) {
    inventoryBodyEl.innerHTML = '<tr><td colspan="4" class="admin-empty admin-error">No se pudo cargar el inventario.</td></tr>';
  }
}

inventoryTableEl.querySelector("thead").addEventListener("click", (event) => {
  const th = event.target.closest("th[data-sort]");
  if (!th) return;
  const key = th.dataset.sort;
  inventorySort = {
    key,
    desc: inventorySort.key === key ? !inventorySort.desc : false,
  };
  renderInventory();
});

function stopThreadPolling() {
  if (threadPollTimer) {
    clearInterval(threadPollTimer);
    threadPollTimer = null;
  }
}

function startThreadPollingIfAssigned() {
  stopThreadPolling();
  const session = sessionsById[selectedSessionId];
  if (!session || session.status !== "assigned") return;

  threadPollTimer = setInterval(async () => {
    if (!selectedSessionId) return;
    try {
      const messages = await fetchJson(`/admin/sessions/${selectedSessionId}/messages`);
      renderThread(messages);
    } catch (err) {
      // Silencioso: se reintenta en el siguiente ciclo.
    }
  }, 4000);
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
  stopThreadPolling();
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

  startThreadPollingIfAssigned();
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
  refreshQueueBadge();
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

  filtersEl.querySelectorAll(".filter-btn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");
  currentStatus = button.dataset.status;
  loadSessions();
});

agentNameInputEl.value = localStorage.getItem(ADMIN_AGENT_NAME_KEY) || "";

loadSummary();
loadStats();
loadSessions();
refreshQueueBadge();
setInterval(refreshQueueBadge, 15000);
