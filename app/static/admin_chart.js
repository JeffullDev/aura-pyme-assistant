// Grafica de lineas en SVG puro (sin librerias externas) para la tarjeta
// "Rentabilidad diaria" de la seccion Resumen del panel de admin. Consume
// roi_calculator.js (cargado antes que este archivo) para la tasa ROI_USD_TO_COP
// y los formatters roiFormatCop/roiFormatUsd, y es consumido por admin.js
// (cargado despues) desde loadResumenChart().

const RESUMEN_CHART_WIDTH = 700;
const RESUMEN_CHART_HEIGHT = 200;
const RESUMEN_CHART_PADDING = { top: 16, right: 16, bottom: 34, left: 16 };
const RESUMEN_CHART_MAX_LABELS = 7;

function resumenChartFormatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

function resumenChartScaleY(value, maxValue, plotHeight) {
  if (maxValue <= 0) return plotHeight;
  const clamped = Math.max(0, value);
  return plotHeight - (clamped / maxValue) * plotHeight;
}

function buildResumenChart(dailyData) {
  if (!dailyData || dailyData.length === 0) {
    return '<p class="admin-empty">No hay datos suficientes para graficar todavía.</p>';
  }

  const width = RESUMEN_CHART_WIDTH;
  const height = RESUMEN_CHART_HEIGHT;
  const pad = RESUMEN_CHART_PADDING;
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  const margins = dailyData.map((d) => d.margin);
  const tokenCostsCop = dailyData.map((d) => d.token_cost * ROI_USD_TO_COP);

  // ESCALA HONESTA (v1.3): un solo eje en COP para ambas series. El costo de
  // tokens va a quedar pegado al eje -- eso es exactamente el mensaje que
  // queremos transmitir (cuesta muy poco frente al margen), no un defecto de
  // la grafica.
  const sharedMax = Math.max(1, ...margins.map((v) => Math.abs(v)), ...tokenCostsCop);

  const stepX = dailyData.length > 1 ? plotWidth / (dailyData.length - 1) : 0;

  const toPoints = (values, maxValue) =>
    values.map((v, i) => {
      const x = pad.left + i * stepX;
      const y = pad.top + resumenChartScaleY(v, maxValue, plotHeight);
      return { x, y };
    });

  const marginPoints = toPoints(margins, sharedMax);
  const tokenPoints = toPoints(tokenCostsCop, sharedMax);

  const toPolyline = (points) => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const y = pad.top + plotHeight * fraction;
      return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" class="resumen-chart-grid" />`;
    })
    .join("");

  const labelEvery = Math.max(1, Math.ceil(dailyData.length / RESUMEN_CHART_MAX_LABELS));
  const dateLabels = dailyData
    .map((d, i) => {
      if (i % labelEvery !== 0 && i !== dailyData.length - 1) return "";
      const x = pad.left + i * stepX;
      return `<text x="${x.toFixed(1)}" y="${height - 10}" class="resumen-chart-axis-label" text-anchor="middle">${resumenChartFormatDateLabel(d.date)}</text>`;
    })
    .join("");

  const marginDots = marginPoints
    .map((p, i) => {
      const d = dailyData[i];
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" class="resumen-chart-dot resumen-chart-dot-margin"><title>${resumenChartFormatDateLabel(d.date)} — margen: ${roiFormatCop(d.margin)}</title></circle>`;
    })
    .join("");
  const tokenDots = tokenPoints
    .map((p, i) => {
      const d = dailyData[i];
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" class="resumen-chart-dot resumen-chart-dot-token"><title>${resumenChartFormatDateLabel(d.date)} — costo de tokens: ${roiFormatCop(d.token_cost * ROI_USD_TO_COP)} (${roiFormatUsd(d.token_cost)})</title></circle>`;
    })
    .join("");

  const svg = `<svg viewBox="0 0 ${width} ${height}" class="resumen-chart-svg" preserveAspectRatio="xMidYMid meet">
    ${gridLines}
    <polyline points="${toPolyline(marginPoints)}" class="resumen-chart-line resumen-chart-line-margin" />
    <polyline points="${toPolyline(tokenPoints)}" class="resumen-chart-line resumen-chart-line-token" />
    ${marginDots}
    ${tokenDots}
    ${dateLabels}
  </svg>`;

  const legend = `<div class="resumen-chart-legend">
    <span class="resumen-chart-legend-item"><span class="resumen-chart-legend-swatch resumen-chart-legend-swatch-margin"></span>Margen de ganancia (COP)</span>
    <span class="resumen-chart-legend-item"><span class="resumen-chart-legend-swatch resumen-chart-legend-swatch-token"></span>Costo de tokens (COP)</span>
  </div>`;

  return `${legend}<div class="resumen-chart-svg-wrapper">${svg}</div>`;
}
