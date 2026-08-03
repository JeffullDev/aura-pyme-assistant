const STATUS_LABELS = {
  active: "Activa",
  escalated: "Escalada",
  assigned: "Asignada",
  closed: "Cerrada",
  abandoned: "Abandonada",
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

const CONVERSATION_CATEGORY_LABELS = {
  venta: "Terminaron en venta",
  garantia: "Consultas de garantía",
  escalada: "Escalas",
  consulta: "Consultas simples",
  abandoned: "Abandonadas",
  closed: "Cerradas",
};

const POLICY_TOPIC_LABELS = {
  horario: "Horario",
  domicilios: "Domicilios",
  garantia: "Garantía",
  pago: "Pago",
};

const VIEW_TITLES = {
  resumen: "Resumen",
  conversations: "Conversaciones",
  orders: "Pedidos",
  inventory: "Inventario",
  costs: "Proyección de costos",
};

const ADMIN_AGENT_NAME_KEY = "aura_admin_agent_name";

const sessionsListEl = document.getElementById("sessions-list");
const sessionsCountEl = document.getElementById("sessions-count");
const threadViewEl = document.getElementById("thread-view");
const threadAssignedBannerEl = document.getElementById("thread-assigned-banner");
const filtersEl = document.getElementById("status-filters");
const agentNameInputEl = document.getElementById("agent-name-input");
const agentNameLabelEl = document.querySelector('label[for="agent-name-input"]');
const agentNameSaveBtnEl = document.getElementById("agent-name-save-btn");
const agentNameDisplayEl = document.getElementById("admin-agent-name-display");
const agentNameValueEl = document.getElementById("admin-agent-name-value");
const agentNameChangeBtnEl = document.getElementById("agent-name-change-btn");
const handoffActionsEl = document.getElementById("handoff-actions");
const takeBtnEl = document.getElementById("take-btn");
const returnBtnEl = document.getElementById("return-btn");
const closeBtnEl = document.getElementById("close-btn");
const replyFormEl = document.getElementById("reply-form");
const replyInputEl = document.getElementById("reply-input");
const conversationsQueueBadgeEl = document.getElementById("conversations-queue-badge");
const queueFilterBadgeEl = document.getElementById("queue-filter-badge");
const conversationsSearchInputEl = document.getElementById("conversations-search-input");

const sidebarEl = document.getElementById("admin-sidebar");
const sidebarToggleBtnEl = document.getElementById("sidebar-toggle-btn");
const sidebarCollapseBtnEl = document.getElementById("sidebar-collapse-btn");
const pageTitleEl = document.getElementById("admin-page-title");

const tabButtonsEl = document.querySelectorAll(".sidebar-nav-btn");
const adminViewsEl = document.querySelectorAll(".admin-view");

const kpiRevenueEl = document.getElementById("kpi-revenue");
const kpiOrdersTotalEl = document.getElementById("kpi-orders-total");
const kpiConversionEl = document.getElementById("kpi-conversion");
const kpiAvgTicketEl = document.getElementById("kpi-avg-ticket");
const kpiTokenCostEl = document.getElementById("kpi-token-cost");
const kpiCostVsRevenueEl = document.getElementById("kpi-cost-vs-revenue");
const kpiCacheSavingsEl = document.getElementById("kpi-cache-savings");
const resumenChartEl = document.getElementById("resumen-chart");
const resumenRangeSelectorEl = document.getElementById("resumen-range-selector");
const resumenRatioStatEl = document.getElementById("resumen-ratio-stat");
const resumenExclusionNoteEl = document.getElementById("resumen-exclusion-note");
const resumenServiceCostNoteEl = document.getElementById("resumen-service-cost-note");
const conversationsBreakdownEl = document.getElementById("conversations-breakdown");
const conversationsPieChartEl = document.getElementById("conversations-pie-chart");
const verTodasConversacionesBtnEl = document.getElementById("ver-todas-conversaciones-btn");
const demandaNoCubiertaEl = document.getElementById("demanda-no-cubierta");
const vozDelClienteEl = document.getElementById("voz-del-cliente");

const ordersFiltersEl = document.getElementById("orders-filters");
const ordersBoardEl = document.getElementById("orders-board");

const inventorySummaryEl = document.getElementById("inventory-summary");
const inventoryBodyEl = document.getElementById("inventory-body");
const inventoryTableEl = document.getElementById("inventory-table");
const inventorySearchInputEl = document.getElementById("inventory-search-input");

let currentStatus = "";
let currentOrderStatus = "";
let selectedSessionId = null;
let sessionsById = {};
let threadPollTimer = null;
let inventoryItems = [];
let inventorySort = { key: "name", desc: false };
let allSessionsCache = [];
const sessionMessagesCache = {};
let conversationsSearchDebounceTimer = null;
let resumenDailyFull = [];
let resumenCurrentRange = "7d";

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

// Los pedidos se cobran en pesos (COP); formatCopWithUsd (usado para el costo
// de tokens en el Resumen) siempre muestra el equivalente en COP primero y el
// monto real en USD entre parentesis, usando la misma tasa ROI_USD_TO_COP que
// ya usa la calculadora de costos (roi_calculator.js), sin duplicarla.
function formatCOP(value) {
  return `$${Math.round(value ?? 0).toLocaleString("es-CO")}`;
}

function formatCopWithUsd(usdValue) {
  const cop = (usdValue ?? 0) * ROI_USD_TO_COP;
  return `${roiFormatCop(cop)} (${roiFormatUsd(usdValue ?? 0)})`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} respondió con estado ${response.status}`);
  }
  return response.json();
}

let sessionsListSnapshot = null;

function sessionRowContent(session) {
  const assignedLabel =
    session.status === "assigned" && session.assigned_agent_name
      ? `<span class="session-assigned-label">Asignada a ${escapeHtml(session.assigned_agent_name)}</span>`
      : "";

  return `
    <div class="session-row-main">
      <span class="session-user">${escapeHtml(session.user_identifier)}</span>
      <span class="status-badge status-${session.status}">${STATUS_LABELS[session.status] || session.status}</span>
    </div>
    ${assignedLabel}
    <div class="session-row-meta">
      <span>${formatDate(session.started_at)}</span>
      <span>${session.message_count} mensaje${session.message_count === 1 ? "" : "s"}</span>
      <span class="session-cost">${formatCost(session.estimated_cost)}</span>
    </div>
  `;
}

function updateSessionRow(row, session) {
  row.classList.toggle("selected", session.id === selectedSessionId);
  row.innerHTML = sessionRowContent(session);
}

function buildSessionRow(session) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "session-row";
  row.dataset.sessionId = session.id;
  row.addEventListener("click", () => selectSession(session.id));
  updateSessionRow(row, session);
  return row;
}

// Diffea contra lo ya renderizado en vez de reconstruir la lista entera: si
// nada cambio no toca el DOM (evita parpadeo), y si algo cambio reutiliza las
// filas existentes (reordenandolas con insertBefore en vez de recrearlas)
// para no perder el scroll ni la seleccion mientras el asesor esta trabajando.
function renderSessions(sessions) {
  // No se resetea sessionsById por completo: si una busqueda filtra la sesion
  // seleccionada fuera de la lista visible, sessionsById[selectedSessionId]
  // debe seguir disponible para el hilo y los controles de handoff.
  sessions.forEach((session) => {
    sessionsById[session.id] = session;
  });

  sessionsCountEl.textContent = `${sessions.length} sesión${sessions.length === 1 ? "" : "es"}`;

  if (sessions.length === 0) {
    sessionsListSnapshot = "[]";
    sessionsListEl.innerHTML = '<p class="admin-empty">No hay sesiones con este filtro.</p>';
    return;
  }

  const snapshot = JSON.stringify(sessions);
  const hasPlaceholder = !!sessionsListEl.querySelector(".admin-empty");
  if (snapshot === sessionsListSnapshot && !hasPlaceholder) {
    return;
  }
  sessionsListSnapshot = snapshot;

  if (hasPlaceholder) {
    sessionsListEl.innerHTML = "";
  }

  const existingRows = new Map();
  sessionsListEl.querySelectorAll(".session-row").forEach((row) => {
    existingRows.set(row.dataset.sessionId, row);
  });

  let previousRow = null;
  sessions.forEach((session) => {
    let row = existingRows.get(session.id);
    if (row) {
      updateSessionRow(row, session);
      existingRows.delete(session.id);
    } else {
      row = buildSessionRow(session);
    }

    const expectedNext = previousRow ? previousRow.nextElementSibling : sessionsListEl.firstElementChild;
    if (expectedNext !== row) {
      sessionsListEl.insertBefore(row, expectedNext);
    }
    previousRow = row;
  });

  // Filas de sesiones que ya no estan en la lista filtrada.
  existingRows.forEach((row) => row.remove());
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

function buildThreadEntry(msg) {
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

  return entry;
}

function isNearBottom(el, threshold = 80) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

let threadRenderedSessionId = null;
let threadRenderedCount = 0;

// El historial de una sesion solo crece (nunca se edita ni se borra un
// mensaje ya logueado), asi que diffear es tan simple como comparar cuantos
// mensajes ya estan pintados contra los que llegan y agregar solo la cola
// nueva — sin reconstruir el hilo completo en cada poll (eso es lo que
// causaba el parpadeo y forzaba el scroll al fondo). Al cambiar de sesion se
// resetea y se repinta completo.
function updateThread(sessionId, messages) {
  const isNewSession = sessionId !== threadRenderedSessionId;
  if (isNewSession) {
    threadRenderedSessionId = sessionId;
    threadRenderedCount = 0;
    threadViewEl.innerHTML = "";
  }

  if (messages.length === 0) {
    if (threadRenderedCount === 0) {
      threadViewEl.innerHTML = '<p class="admin-empty">Esta sesión no tiene mensajes.</p>';
    }
    return;
  }

  if (!isNewSession && messages.length <= threadRenderedCount) {
    return;
  }

  const wasNearBottom = isNewSession || isNearBottom(threadViewEl);
  if (threadRenderedCount === 0) {
    threadViewEl.innerHTML = "";
  }

  messages.slice(threadRenderedCount).forEach((msg) => {
    threadViewEl.appendChild(buildThreadEntry(msg));
  });
  threadRenderedCount = messages.length;

  if (wasNearBottom) {
    threadViewEl.scrollTop = threadViewEl.scrollHeight;
  }
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
  pageTitleEl.textContent = VIEW_TITLES[view] || "";
  sidebarEl.classList.remove("open");

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

sidebarToggleBtnEl.addEventListener("click", () => {
  sidebarEl.classList.toggle("open");
});

sidebarCollapseBtnEl.addEventListener("click", () => {
  sidebarEl.classList.toggle("collapsed");
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

function renderConversationsBreakdown(stats) {
  const byCategory = stats.conversations_by_category || {};
  const rows = ["venta", "garantia", "escalada", "consulta", "abandoned", "closed"]
    .map((cat) => {
      const count = byCategory[cat] || 0;
      return `<div class="breakdown-row"><span class="breakdown-label">${CONVERSATION_CATEGORY_LABELS[cat]}</span><span class="breakdown-value">${count}</span></div>`;
    })
    .join("");

  conversationsBreakdownEl.innerHTML = `
    <div class="breakdown-total"><span class="breakdown-total-value">${formatTokens(stats.total_conversations)}</span> conversaciones totales</div>
    <div class="breakdown-rows">${rows}</div>
  `;

  conversationsPieChartEl.innerHTML = buildConversationsPieChart(byCategory, CONVERSATION_CATEGORY_LABELS);
}

async function loadUncoveredDemand() {
  demandaNoCubiertaEl.innerHTML = '<p class="admin-empty">Cargando...</p>';
  try {
    const items = await fetchJson("/admin/demanda-no-cubierta");
    const top5 = items.slice(0, 5);
    if (top5.length === 0) {
      demandaNoCubiertaEl.innerHTML = '<p class="admin-empty">No se ha detectado demanda no cubierta todavía.</p>';
      return;
    }
    demandaNoCubiertaEl.innerHTML = `
      <ol class="demanda-list">
        ${top5
          .map(
            (item) =>
              `<li><span class="demanda-term">${escapeHtml(item.term)}</span><span class="demanda-count">${item.count} búsqueda${item.count === 1 ? "" : "s"}</span></li>`
          )
          .join("")}
      </ol>
    `;
  } catch (err) {
    demandaNoCubiertaEl.innerHTML = '<p class="admin-empty admin-error">No se pudo cargar la demanda no cubierta.</p>';
  }
}

function renderVozClienteTermList(title, items, emptyText) {
  const rows = items
    .map(
      (item) =>
        `<div class="breakdown-row"><span class="breakdown-label">${escapeHtml(item.term)}</span><span class="breakdown-value">${item.count}</span></div>`
    )
    .join("");
  return `
    <div class="voz-cliente-section">
      <h3>${title}</h3>
      ${items.length === 0 ? `<p class="admin-empty">${emptyText}</p>` : `<div class="breakdown-rows">${rows}</div>`}
    </div>
  `;
}

async function loadVoiceOfCustomer() {
  vozDelClienteEl.innerHTML = '<p class="admin-empty">Cargando...</p>';
  try {
    const data = await fetchJson("/admin/voz-del-cliente");
    const policyTopics = data.policy_topics || [];
    const catalogTerms = data.catalog_terms || [];
    const knowledgeTerms = data.knowledge_terms || [];
    const escalationReasons = data.escalation_reasons || [];

    const policyRows = policyTopics
      .map(
        (item) =>
          `<div class="breakdown-row"><span class="breakdown-label">${POLICY_TOPIC_LABELS[item.topic] || escapeHtml(item.topic)}</span><span class="breakdown-value">${item.count}</span></div>`
      )
      .join("");

    const escalationRows = escalationReasons
      .map(
        (item) =>
          `<li><span class="demanda-term">${escapeHtml(item.reason)}</span><span class="voz-cliente-reason-date">${formatDate(item.created_at)}</span></li>`
      )
      .join("");

    vozDelClienteEl.innerHTML = `
      <div class="voz-cliente-section">
        <h3>Temas de política más consultados</h3>
        ${policyTopics.length === 0 ? '<p class="admin-empty">Sin consultas todavía.</p>' : `<div class="breakdown-rows">${policyRows}</div>`}
      </div>
      ${renderVozClienteTermList("Productos más buscados", catalogTerms, "Sin búsquedas todavía.")}
      ${renderVozClienteTermList("Preguntas a la base de conocimiento", knowledgeTerms, "Sin búsquedas todavía.")}
      <div class="voz-cliente-section">
        <h3>Motivos de escalamiento recientes</h3>
        ${escalationReasons.length === 0 ? '<p class="admin-empty">Sin escalamientos todavía.</p>' : `<ol class="demanda-list voz-cliente-reasons">${escalationRows}</ol>`}
      </div>
    `;
  } catch (err) {
    vozDelClienteEl.innerHTML = '<p class="admin-empty admin-error">No se pudo cargar "Lo que dice la gente".</p>';
  }
}

// Rango del selector tipo grafica de acciones: se aplica en el cliente sobre
// la serie completa que devuelve /admin/resumen-diario, sin volver a pedirla
// (ver get_daily_summary en repository.py, que ya trae todo el historial).
function filterDailyByRange(daily, range) {
  if (range === "today") return daily.slice(-1);
  if (range === "7d") return daily.slice(-7);
  if (range === "30d") return daily.slice(-30);
  return daily;
}

function renderResumenRatioStat(filtered) {
  const marginTotal = filtered.reduce((sum, d) => sum + d.margin, 0);
  const tokenCostTotalCop = filtered.reduce((sum, d) => sum + d.token_cost * ROI_USD_TO_COP, 0);
  if (tokenCostTotalCop <= 0) {
    resumenRatioStatEl.innerHTML = `Sin costo de tokens registrado en este rango todavía.`;
    return;
  }
  const ratio = marginTotal / tokenCostTotalCop;
  resumenRatioStatEl.innerHTML = `Por cada $1 invertido en tokens, el asistente generó <span class="resumen-ratio-value">$${ratio.toLocaleString("es-CO", { maximumFractionDigits: 0 })}</span> de margen`;
}

function renderResumenChartForRange() {
  const filtered = filterDailyByRange(resumenDailyFull, resumenCurrentRange);
  resumenChartEl.innerHTML = buildResumenChart(filtered);
  renderResumenRatioStat(filtered);
}

resumenRangeSelectorEl.addEventListener("click", (event) => {
  const button = event.target.closest(".range-btn");
  if (!button) return;
  resumenRangeSelectorEl.querySelectorAll(".range-btn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");
  resumenCurrentRange = button.dataset.range;
  renderResumenChartForRange();
});

async function loadResumenChart() {
  resumenChartEl.innerHTML = '<p class="admin-empty">Cargando gráfica...</p>';
  resumenRatioStatEl.textContent = "Calculando...";
  try {
    const data = await fetchJson("/admin/resumen-diario");
    resumenDailyFull = data.daily || [];
    const excludedCount = data.excluded_orders_count || 0;
    if (excludedCount > 0) {
      resumenExclusionNoteEl.textContent = `Nota: ${excludedCount} pedido${excludedCount === 1 ? "" : "s"} no se incluyen en el margen porque no tienen registrado el costo de la mercancía.`;
      resumenExclusionNoteEl.hidden = false;
    } else {
      resumenExclusionNoteEl.hidden = true;
    }
    const serviceCostOther = data.service_cost_other_conversations || 0;
    if (serviceCostOther > 0) {
      resumenServiceCostNoteEl.textContent = `Además, el negocio gastó ${formatCopWithUsd(serviceCostOther)} en tokens atendiendo conversaciones que no terminaron en venta (consultas, garantías, escalas) — un costo real de servicio, no incluido en la gráfica de arriba.`;
      resumenServiceCostNoteEl.hidden = false;
    } else {
      resumenServiceCostNoteEl.hidden = true;
    }
    renderResumenChartForRange();
  } catch (err) {
    resumenChartEl.innerHTML = '<p class="admin-empty admin-error">No se pudo cargar la gráfica.</p>';
    resumenRatioStatEl.textContent = "—";
  }
}

async function loadSummary() {
  try {
    const stats = await fetchJson("/admin/stats");
    kpiRevenueEl.textContent = formatCOP(stats.revenue_total);
    kpiOrdersTotalEl.textContent = formatTokens(stats.total_orders);
    kpiConversionEl.textContent = `${formatTokens(stats.total_orders)} de ${formatTokens(stats.total_conversations)} conversaciones terminaron en compra (${formatPercent(stats.conversion_rate)})`;
    kpiAvgTicketEl.textContent = formatCOP(stats.avg_ticket);
    kpiTokenCostEl.textContent = formatCopWithUsd(stats.total_estimated_cost);
    kpiCostVsRevenueEl.textContent = `Generó ${formatCOP(stats.revenue_total)} en pedidos — costó ${formatCopWithUsd(stats.total_estimated_cost)} en tokens`;
    const cacheReadTokens = stats.cache_read_tokens || 0;
    if (cacheReadTokens > 0) {
      kpiCacheSavingsEl.textContent = `${formatTokens(cacheReadTokens)} tokens servidos desde cache — ahorró ${formatCopWithUsd(stats.cache_savings_usd)} frente a precio completo`;
    } else {
      kpiCacheSavingsEl.textContent = "Sin lecturas de cache todavía";
    }
    renderConversationsBreakdown(stats);
  } catch (err) {
    document.querySelectorAll("#view-resumen .kpi-value").forEach((el) => {
      el.textContent = "—";
    });
  }

  loadResumenChart();
  loadUncoveredDemand();
  loadVoiceOfCustomer();
}

verTodasConversacionesBtnEl.addEventListener("click", () => switchAdminView("conversations"));

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

// ---------- Pedidos: antiguedad, agrupacion y badges ----------

const ORDER_AGE_MAX_HOURS = 48;
const ORDER_AGE_COLOR_FROM = [220, 252, 231]; // verde (recien llegado), = --agent-bg
const ORDER_AGE_COLOR_TO = [254, 226, 226]; // rojo suave (lleva rato esperando)

function orderAgeBackground(order) {
  const hours = Math.max(0, (Date.now() - new Date(order.created_at).getTime()) / 3600000);
  const fraction = Math.min(1, hours / ORDER_AGE_MAX_HOURS);
  const rgb = ORDER_AGE_COLOR_FROM.map((component, i) =>
    Math.round(component + (ORDER_AGE_COLOR_TO[i] - component) * fraction)
  );
  return `rgb(${rgb.join(",")})`;
}

function formatElapsedSince(isoString) {
  const ms = Date.now() - new Date(isoString).getTime();
  if (ms <= 0) return "menos de 1 min";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0 && minutes > 0) parts.push(`${minutes}min`);
  return parts.length ? parts.join(" ") : "menos de 1 min";
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Orden de grupos = del mas antiguo al mas reciente (el mas urgente de
// despachar primero), NO el orden cronologico habitual de un inbox.
const ORDER_GROUP_KEYS = ["anteriores", "esta_semana", "ayer", "hoy"];
const ORDER_GROUP_TITLES = {
  anteriores: "Anteriores",
  esta_semana: "Esta semana",
  ayer: "Ayer",
  hoy: "Hoy",
};

function orderDateGroup(order) {
  const createdDay = startOfDay(order.created_at).getTime();
  const today = startOfDay(new Date()).getTime();
  const diffDays = Math.round((today - createdDay) / 86400000);

  if (diffDays <= 0) return "hoy";
  if (diffDays === 1) return "ayer";
  if (diffDays <= 7) return "esta_semana";
  return "anteriores";
}

function groupAndSortOrders(orders) {
  const groups = {};
  ORDER_GROUP_KEYS.forEach((key) => {
    groups[key] = [];
  });
  orders.forEach((order) => {
    groups[orderDateGroup(order)].push(order);
  });
  ORDER_GROUP_KEYS.forEach((key) => {
    groups[key].sort((a, b) => new Date(a.estimated_delivery_at) - new Date(b.estimated_delivery_at));
  });
  return groups;
}

function renderOrderCard(order) {
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

  const cardClass = overdue ? "order-card order-card-overdue" : "order-card";
  const cardStyle = overdue ? "" : ` style="background:${orderAgeBackground(order)}"`;
  const overdueBadge = overdue
    ? `<span class="order-overdue-badge">RETRASADO · ${formatElapsedSince(order.estimated_delivery_at)} vencido</span>`
    : "";

  return `
    <article class="${cardClass}"${cardStyle}>
      <div class="order-card-header">
        <span class="order-reference">#${order.id.slice(0, 8)}</span>
        <span class="status-badge status-${order.status}">${ORDER_STATUS_LABELS[order.status] || order.status}</span>
      </div>
      ${overdueBadge}
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
    </article>
  `;
}

function renderOrders(orders) {
  if (orders.length === 0) {
    ordersBoardEl.innerHTML = '<p class="admin-empty">No hay pedidos con este filtro.</p>';
    return;
  }

  const groups = groupAndSortOrders(orders);
  const sectionsHtml = ORDER_GROUP_KEYS.filter((key) => groups[key].length > 0)
    .map(
      (key) => `
        <section class="orders-date-group">
          <h3 class="orders-date-group-title">${ORDER_GROUP_TITLES[key]}</h3>
          <div class="orders-board">${groups[key].map(renderOrderCard).join("")}</div>
        </section>
      `
    )
    .join("");

  ordersBoardEl.innerHTML = sectionsHtml;
}

async function refreshOrdersBadges() {
  try {
    const orders = await fetchJson("/admin/orders");
    const counts = { pending: 0, confirmed: 0, in_transit: 0 };
    orders.forEach((order) => {
      if (order.status in counts) counts[order.status] += 1;
    });
    Object.keys(counts).forEach((status) => {
      const el = document.getElementById(`orders-badge-${status}`);
      if (!el) return;
      el.textContent = String(counts[status]);
      el.hidden = counts[status] === 0;
    });
  } catch (err) {
    // Silencioso: los badges simplemente no se actualizan en este ciclo.
  }
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
  refreshOrdersBadges();
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

// ---------- Inventario ----------

function inventoryAlertClass(stock) {
  if (stock === 0) return "inventory-row-out";
  if (stock <= 4) return "inventory-row-low";
  return "";
}

function computeMargin(item) {
  const price = item.price || 0;
  const cost = item.cost_price;
  if (cost === null || cost === undefined || price === 0) {
    return { abs: null, pct: null };
  }
  const marginAbs = price - cost;
  const marginPct = (marginAbs / price) * 100;
  return { abs: marginAbs, pct: marginPct };
}

function inventorySortValue(item, key) {
  if (key === "margin_pct") {
    const { pct } = computeMargin(item);
    return pct === null ? -Infinity : pct;
  }
  return item[key];
}

function filterInventoryItems(items) {
  const term = inventorySearchInputEl.value.trim().toLowerCase();
  if (!term) return items;
  return items.filter(
    (item) => (item.name || "").toLowerCase().includes(term) || (item.category || "").toLowerCase().includes(term)
  );
}

function renderInventory() {
  const outCount = inventoryItems.filter((item) => item.stock === 0).length;
  const lowCount = inventoryItems.filter((item) => item.stock > 0 && item.stock <= 4).length;
  inventorySummaryEl.innerHTML = `
    <span class="status-badge status-error">${outCount} producto${outCount === 1 ? "" : "s"} agotado${outCount === 1 ? "" : "s"}</span>
    <span class="status-badge status-escalated">${lowCount} con stock bajo</span>
  `;

  const filtered = filterInventoryItems(inventoryItems);
  const sorted = [...filtered].sort((a, b) => {
    const { key, desc } = inventorySort;
    const va = inventorySortValue(a, key);
    const vb = inventorySortValue(b, key);
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return desc ? -cmp : cmp;
  });

  if (sorted.length === 0) {
    inventoryBodyEl.innerHTML = '<tr><td colspan="6" class="admin-empty">No hay productos que coincidan.</td></tr>';
    return;
  }

  inventoryBodyEl.innerHTML = "";
  sorted.forEach((item) => {
    const row = document.createElement("tr");
    row.className = inventoryAlertClass(item.stock);
    const { abs, pct } = computeMargin(item);
    const marginCell = abs === null ? "—" : `${formatPercent(pct)} <span class="margin-abs">(${formatCOP(abs)})</span>`;
    row.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category || "—")}</td>
      <td>${item.cost_price != null ? formatCOP(item.cost_price) : "—"}</td>
      <td>${formatCOP(item.price)}</td>
      <td>${marginCell}</td>
      <td>${item.stock}</td>
    `;
    inventoryBodyEl.appendChild(row);
  });
}

async function loadInventory() {
  inventoryBodyEl.innerHTML = '<tr><td colspan="6" class="admin-empty">Cargando inventario...</td></tr>';
  try {
    inventoryItems = await fetchJson("/admin/inventory");
    renderInventory();
  } catch (err) {
    inventoryBodyEl.innerHTML = '<tr><td colspan="6" class="admin-empty admin-error">No se pudo cargar el inventario.</td></tr>';
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

inventorySearchInputEl.addEventListener("input", renderInventory);

// ---------- Conversaciones: busqueda por cliente y contenido ----------

function renderFilteredSessions() {
  const term = conversationsSearchInputEl.value.trim().toLowerCase();
  if (!term) {
    renderSessions(allSessionsCache);
    return;
  }
  filterSessionsByTerm(term);
}

async function filterSessionsByTerm(term) {
  const toFetch = allSessionsCache.filter((session) => !(session.id in sessionMessagesCache));
  if (toFetch.length > 0) {
    sessionsListEl.innerHTML = '<p class="admin-empty">Buscando...</p>';
    await Promise.all(
      toFetch.map(async (session) => {
        try {
          const { messages } = await fetchJson(`/admin/sessions/${session.id}/messages`);
          sessionMessagesCache[session.id] = messages
            .filter((msg) => msg.content)
            .map((msg) => msg.content.toLowerCase())
            .join(" ");
        } catch (err) {
          sessionMessagesCache[session.id] = "";
        }
      })
    );
  }

  // El termino de busqueda pudo cambiar mientras esperabamos los fetch.
  const currentTerm = conversationsSearchInputEl.value.trim().toLowerCase();
  if (currentTerm !== term) return;

  const filtered = allSessionsCache.filter((session) => {
    if (session.user_identifier.toLowerCase().includes(term)) return true;
    return (sessionMessagesCache[session.id] || "").includes(term);
  });
  renderSessions(filtered);
}

conversationsSearchInputEl.addEventListener("input", () => {
  clearTimeout(conversationsSearchDebounceTimer);
  conversationsSearchDebounceTimer = setTimeout(renderFilteredSessions, 250);
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
    const sessionId = selectedSessionId;
    if (!sessionId) return;
    try {
      const { status, ended_at, messages } = await fetchJson(`/admin/sessions/${sessionId}/messages`);
      if (selectedSessionId !== sessionId) return;
      updateThread(sessionId, messages);

      // El poll trae el status real de la sesion: si otro asesor (u otra
      // pestaña) la devolvio al bot, la cerro, o se auto-cerro por
      // inactividad mientras este panel seguia leyendola, hay que reflejarlo
      // aqui — no solo cuando el usuario recarga o vuelve a seleccionarla.
      const cached = sessionsById[sessionId];
      if (cached && (cached.status !== status || cached.ended_at !== ended_at)) {
        sessionsById[sessionId] = { ...cached, status, ended_at };
        updateHandoffControls();
      }
      if (status !== "assigned") {
        stopThreadPolling();
      }
    } catch (err) {
      // Silencioso: se reintenta en el siguiente ciclo.
    }
  }, 4000);
}

async function loadSessions() {
  // Solo muestra el placeholder de carga si la lista esta vacia todavia: en
  // recargas posteriores (tras tomar/cerrar/responder una conversacion) ya
  // hay filas pintadas, y reemplazarlas por "Cargando..." de entrada anularia
  // el diff de renderSessions — volveria a reconstruir la lista completa en
  // cada accion, justo el parpadeo que se esta arreglando.
  if (!sessionsListEl.querySelector(".session-row")) {
    sessionsListEl.innerHTML = '<p class="admin-empty">Cargando sesiones...</p>';
  }
  try {
    const url = currentStatus ? `/admin/sessions?status=${currentStatus}` : "/admin/sessions";
    allSessionsCache = await fetchJson(url);
    renderFilteredSessions();
  } catch (err) {
    sessionsListEl.innerHTML = '<p class="admin-empty admin-error">No se pudieron cargar las sesiones.</p>';
  }
}

// Cubre tanto el aviso de "Asignada a X" como el aviso de solo-lectura para
// sesiones terminales (closed/abandoned) — antes solo existia el primero, y
// una sesion cerrada mientras el asesor la leia no mostraba ningun indicio
// de por que el campo de respuesta desaparecio.
function updateThreadAssignedBanner() {
  const session = sessionsById[selectedSessionId];
  threadAssignedBannerEl.classList.remove("thread-assigned-banner-readonly");

  if (session && session.status === "assigned" && session.assigned_agent_name) {
    threadAssignedBannerEl.textContent = `Asignada a ${session.assigned_agent_name}`;
    threadAssignedBannerEl.hidden = false;
    return;
  }

  if (session && (session.status === "closed" || session.status === "abandoned")) {
    const closedLabel =
      session.status === "abandoned"
        ? `Cerrada automáticamente por inactividad el ${formatDate(session.ended_at)}`
        : `Cerrada el ${formatDate(session.ended_at)}`;
    threadAssignedBannerEl.textContent = `${closedLabel} · Solo lectura`;
    threadAssignedBannerEl.classList.add("thread-assigned-banner-readonly");
    threadAssignedBannerEl.hidden = false;
    return;
  }

  threadAssignedBannerEl.hidden = true;
}

function updateHandoffControls() {
  const session = sessionsById[selectedSessionId];
  if (!session) {
    handoffActionsEl.hidden = true;
    replyFormEl.hidden = true;
    updateThreadAssignedBanner();
    return;
  }

  const isAssigned = session.status === "assigned";
  // 'abandoned' (v1.3) es tan terminal como 'closed': la sesion se cerro sola
  // por inactividad, no tiene sentido "tomarla" ni "cerrarla" de nuevo. Ambas
  // son de solo lectura: sin campo de respuesta ni botones de handoff.
  const isTerminal = session.status === "closed" || session.status === "abandoned";

  handoffActionsEl.hidden = false;
  takeBtnEl.hidden = isAssigned || isTerminal;
  returnBtnEl.hidden = !isAssigned;
  closeBtnEl.hidden = isTerminal;
  replyFormEl.hidden = !isAssigned;
  updateThreadAssignedBanner();
}

async function selectSession(sessionId) {
  stopThreadPolling();
  selectedSessionId = sessionId;
  document.querySelectorAll(".session-row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.sessionId === sessionId);
  });
  threadViewEl.innerHTML = '<p class="admin-empty">Cargando hilo...</p>';
  threadRenderedSessionId = null;
  threadRenderedCount = 0;
  updateHandoffControls();

  try {
    const { status, ended_at, messages } = await fetchJson(`/admin/sessions/${sessionId}/messages`);
    const cached = sessionsById[sessionId];
    if (cached) {
      sessionsById[sessionId] = { ...cached, status, ended_at };
    }
    updateThread(sessionId, messages);
    updateHandoffControls();
  } catch (err) {
    threadViewEl.innerHTML = '<p class="admin-empty admin-error">No se pudo cargar el hilo de la conversación.</p>';
    threadRenderedSessionId = null;
    threadRenderedCount = 0;
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

// ---------- Nombre del asesor: persistente en localStorage ----------

function showAgentNameDisplay(name) {
  agentNameValueEl.textContent = name;
  agentNameDisplayEl.hidden = false;
  agentNameInputEl.hidden = true;
  agentNameSaveBtnEl.hidden = true;
  if (agentNameLabelEl) agentNameLabelEl.hidden = true;
}

function showAgentNameInput() {
  agentNameDisplayEl.hidden = true;
  agentNameInputEl.hidden = false;
  agentNameSaveBtnEl.hidden = false;
  if (agentNameLabelEl) agentNameLabelEl.hidden = false;
  agentNameInputEl.focus();
}

function saveAgentName() {
  const name = agentNameInputEl.value.trim();
  if (!name) {
    alert("Escribe tu nombre antes de guardarlo.");
    agentNameInputEl.focus();
    return;
  }
  localStorage.setItem(ADMIN_AGENT_NAME_KEY, name);
  showAgentNameDisplay(name);
}

function getAgentName() {
  const name = (localStorage.getItem(ADMIN_AGENT_NAME_KEY) || "").trim();
  if (!name) {
    alert("Escribe y guarda tu nombre en el panel lateral antes de tomar una conversación.");
    showAgentNameInput();
    return null;
  }
  return name;
}

agentNameSaveBtnEl.addEventListener("click", saveAgentName);
agentNameInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveAgentName();
  }
});
agentNameChangeBtnEl.addEventListener("click", showAgentNameInput);

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

const savedAgentName = localStorage.getItem(ADMIN_AGENT_NAME_KEY);
if (savedAgentName) {
  agentNameInputEl.value = savedAgentName;
  showAgentNameDisplay(savedAgentName);
} else {
  showAgentNameInput();
}

loadSummary();
loadStats();
loadSessions();
refreshQueueBadge();
setInterval(refreshQueueBadge, 15000);
