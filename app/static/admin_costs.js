// Pestaña "Proyección de costos" del panel de admin. Usa las funciones puras
// de roi_calculator.js (cargado antes que este script) y fetchJson/switchAdminView,
// ya definidos en admin.js (cargado antes de este archivo) -- ese archivo es el
// dueño de la navegación por pestañas, comun a las 5 secciones del panel.

const COSTS_DEFAULT_TOKENS_PER_CONVERSATION_FALLBACK = 14703;
const COSTS_GROWTH_SCENARIOS = [
  { label: "Volumen actual", multiplier: 1 },
  { label: "x2 (doble)", multiplier: 2 },
  { label: "x5 (quíntuple)", multiplier: 5 },
];

const costsConversationsInput = document.getElementById("costs-conversations-per-day");
const costsTokensInput = document.getElementById("costs-tokens-per-conversation");
const costsTokensValueLabel = document.getElementById("costs-tokens-per-conversation-value");
const costsAvgNoteEl = document.getElementById("costs-avg-note");

const costsDayUsdEl = document.getElementById("costs-day-usd");
const costsDayCopEl = document.getElementById("costs-day-cop");
const costsMonthUsdEl = document.getElementById("costs-month-usd");
const costsMonthCopEl = document.getElementById("costs-month-cop");
const costsYearUsdEl = document.getElementById("costs-year-usd");
const costsYearCopEl = document.getElementById("costs-year-cop");
const costsCompareAiEl = document.getElementById("costs-compare-ai");
const costsCompareAiUsdSubEl = document.getElementById("costs-compare-ai-usd-sub");
const costsCompareHumanEl = document.getElementById("costs-compare-human");
const costsCompareHumanHoursEl = document.getElementById("costs-compare-human-hours");
const costsGrowthBodyEl = document.getElementById("costs-growth-body");

function renderGrowthTable(conversationsPerDay, tokensPerConversation) {
  costsGrowthBodyEl.innerHTML = "";
  COSTS_GROWTH_SCENARIOS.forEach(({ label, multiplier }) => {
    const scenarioConversations = conversationsPerDay * multiplier;
    const result = calculateRoi(scenarioConversations, tokensPerConversation);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${label}</td>
      <td>${scenarioConversations.toLocaleString("es-CO")} conv/día</td>
      <td>${roiFormatUsd(result.costPerMonthUsd)}</td>
      <td>${roiFormatCop(result.costPerMonthCop)}</td>
    `;
    costsGrowthBodyEl.appendChild(row);
  });
}

function recalculateCosts() {
  const conversationsPerDay = Math.max(0, Number(costsConversationsInput.value) || 0);
  const tokensPerConversation = Math.max(0, Number(costsTokensInput.value) || 0);
  costsTokensValueLabel.textContent = tokensPerConversation.toLocaleString("es-CO");

  const result = calculateRoi(conversationsPerDay, tokensPerConversation);

  costsDayUsdEl.textContent = roiFormatUsd(result.costPerDayUsd);
  costsDayCopEl.textContent = `≈ ${roiFormatCop(result.costPerDayCop)}`;
  costsMonthUsdEl.textContent = roiFormatUsd(result.costPerMonthUsd);
  costsMonthCopEl.textContent = `≈ ${roiFormatCop(result.costPerMonthCop)}`;
  costsYearUsdEl.textContent = roiFormatUsd(result.costPerYearUsd);
  costsYearCopEl.textContent = `≈ ${roiFormatCop(result.costPerYearCop)}`;

  costsCompareAiEl.textContent = roiFormatCop(result.costPerMonthCop);
  costsCompareAiUsdSubEl.textContent = `Equivale a ${roiFormatUsd(result.costPerMonthUsd)} — así lo factura Anthropic realmente`;
  costsCompareHumanEl.textContent = roiFormatCop(result.humanCostMonthlyCop);
  costsCompareHumanHoursEl.textContent = `≈ ${result.horasPorDia.toFixed(1)} h/día atendiendo, a una tarifa de referencia`;

  renderGrowthTable(conversationsPerDay, tokensPerConversation);
}

async function loadCostsDefaults() {
  try {
    const stats = await fetchJson("/admin/stats");
    const avg = stats.avg_tokens_per_conversation;
    if (avg && avg > 0) {
      const rounded = Math.round(avg);
      costsTokensInput.value = Math.min(Math.max(rounded, Number(costsTokensInput.min)), Number(costsTokensInput.max));
      costsAvgNoteEl.textContent = `Promedio real observado en tus conversaciones registradas: ${rounded.toLocaleString("es-CO")} tokens/conversación (usado como valor por defecto).`;
    } else {
      costsTokensInput.value = COSTS_DEFAULT_TOKENS_PER_CONVERSATION_FALLBACK;
      costsAvgNoteEl.textContent = `Todavía no hay suficientes conversaciones registradas para calcular un promedio real; se usa un valor de referencia (${COSTS_DEFAULT_TOKENS_PER_CONVERSATION_FALLBACK.toLocaleString("es-CO")} tokens/conversación).`;
    }
  } catch (err) {
    costsTokensInput.value = COSTS_DEFAULT_TOKENS_PER_CONVERSATION_FALLBACK;
    costsAvgNoteEl.textContent = `No se pudo cargar el promedio real desde el servidor; se usa un valor de referencia (${COSTS_DEFAULT_TOKENS_PER_CONVERSATION_FALLBACK.toLocaleString("es-CO")} tokens/conversación).`;
  }
  recalculateCosts();
}

costsConversationsInput.addEventListener("input", recalculateCosts);
costsTokensInput.addEventListener("input", recalculateCosts);

loadCostsDefaults();
