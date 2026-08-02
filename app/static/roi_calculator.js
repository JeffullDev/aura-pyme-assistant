// Motor de calculo puro de la calculadora de costo del asistente IA. Lo usa la
// pestaña "Proyección de costos" del panel de admin (admin.html + admin_costs.js).
//
// docs/artifact_calculadora_roi.html mantiene su PROPIA copia de esta misma
// logica, inline: ese archivo es un entregable standalone del reto (debe
// funcionar como HTML unico, sin servidor), asi que no puede depender de un
// <script src> externo. Si cambias una constante o formula aqui, replica el
// cambio alla para que ambos no diverjan.

const ROI_PRICE_PER_MILLION_INPUT_TOKENS = 3.0;
const ROI_PRICE_PER_MILLION_OUTPUT_TOKENS = 15.0;
const ROI_BLENDED_PRICE_PER_MILLION_TOKENS =
  0.7 * ROI_PRICE_PER_MILLION_INPUT_TOKENS + 0.3 * ROI_PRICE_PER_MILLION_OUTPUT_TOKENS;

// Tasa de referencia USD -> COP, AJUSTABLE. Ver el comentario extenso en
// docs/artifact_calculadora_roi.html: no es una tasa oficial ni en tiempo
// real, solo permite comparar el costo del asistente IA (que Anthropic
// factura en USD) contra el costo de una persona (en COP) en la misma moneda.
const ROI_USD_TO_COP = 4100;

// Valores de referencia ilustrativos para la comparacion con una persona, NO
// cifras oficiales. Ajustar al salario minimo y prestaciones vigentes en Colombia.
const ROI_SALARIO_MINIMO_MENSUAL_COP = 1300000;
const ROI_AUXILIO_TRANSPORTE_COP = 162000;
const ROI_FACTOR_PRESTACIONES = 1.52; // cesantias, prima, vacaciones, seguridad social patronal (aprox)
const ROI_HORAS_LABORALES_MES = 220;
const ROI_MINUTOS_ATENCION_HUMANA_POR_CONVERSACION = 4; // supuesto ilustrativo, no medido

const ROI_COSTO_HORA_PERSONA =
  ((ROI_SALARIO_MINIMO_MENSUAL_COP + ROI_AUXILIO_TRANSPORTE_COP) * ROI_FACTOR_PRESTACIONES) /
  ROI_HORAS_LABORALES_MES;

// "US$" y el sufijo " COP" evitan que ambas monedas se lean como si fueran la
// misma: los simbolos "$" nativos de en-US y es-CO son identicos a simple
// vista, que fue la fuente del bug original (IA en USD comparada como si
// fuera COP).
function roiFormatUsd(value) {
  const number = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `US$ ${number}`;
}

function roiFormatCop(value) {
  const number = Math.round(value).toLocaleString("es-CO");
  return `$ ${number} COP`;
}

// conversationsPerDay, tokensPerConversation -> desglose de costo en USD/COP
// del asistente IA y del costo mensual estimado de una persona en el mismo
// volumen. Funcion pura: no toca el DOM ni hace fetch, para poder reusarla
// tanto en el calculo del escenario actual como en la tabla de proyeccion.
function calculateRoi(conversationsPerDay, tokensPerConversation) {
  const tokensPerDay = conversationsPerDay * tokensPerConversation;
  const costPerDayUsd = (tokensPerDay / 1_000_000) * ROI_BLENDED_PRICE_PER_MILLION_TOKENS;
  const costPerMonthUsd = costPerDayUsd * 30;
  const costPerYearUsd = costPerDayUsd * 365;

  const costPerDayCop = costPerDayUsd * ROI_USD_TO_COP;
  const costPerMonthCop = costPerMonthUsd * ROI_USD_TO_COP;
  const costPerYearCop = costPerYearUsd * ROI_USD_TO_COP;

  const minutosPorDia = conversationsPerDay * ROI_MINUTOS_ATENCION_HUMANA_POR_CONVERSACION;
  const horasPorDia = minutosPorDia / 60;
  const humanCostMonthlyCop = horasPorDia * 30 * ROI_COSTO_HORA_PERSONA;

  return {
    costPerDayUsd,
    costPerMonthUsd,
    costPerYearUsd,
    costPerDayCop,
    costPerMonthCop,
    costPerYearCop,
    horasPorDia,
    humanCostMonthlyCop,
  };
}
