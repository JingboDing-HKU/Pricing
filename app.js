const DEFAULTS = {
  lambda: 0.12,
  termMonths: 12,
  payout: 1000,
  policies: 12000,
  multiTrigger: true,
  thresholdStart: 70,
  thresholdFull: 120,
  indexMean: 96,
  indexVol: 24,
  discountRate: 2.5,
  riskLoad: 25,
  expenseLoad: 12,
  profitLoad: 3,
  affectedShare: 85,
  retentionM: 6,
  reinsuranceM: 5,
  catBondM: 4,
  liquidityBuffer: 110,
  stablecoinShare: 8,
  eventMonth: 6,
};

const CONTROL_META = {
  lambda: { suffix: "/yr", decimals: 2 },
  termMonths: { suffix: " mo", decimals: 0 },
  payout: { prefix: "HK$", decimals: 0 },
  policies: { suffix: " policies", decimals: 0 },
  thresholdStart: { decimals: 0 },
  thresholdFull: { decimals: 0 },
  indexMean: { decimals: 0 },
  indexVol: { decimals: 0 },
  discountRate: { suffix: "%", decimals: 1 },
  riskLoad: { suffix: "%", decimals: 0 },
  expenseLoad: { suffix: "%", decimals: 0 },
  profitLoad: { suffix: "%", decimals: 0 },
  affectedShare: { suffix: "%", decimals: 0 },
  retentionM: { suffix: "m", prefix: "HK$", decimals: 1 },
  reinsuranceM: { suffix: "m", prefix: "HK$", decimals: 1 },
  catBondM: { suffix: "m", prefix: "HK$", decimals: 1 },
  liquidityBuffer: { suffix: "%", decimals: 0 },
  stablecoinShare: { suffix: "%", decimals: 0 },
  eventMonth: { decimals: 0 },
};

const COLORS = {
  ink: "#18212f",
  muted: "#64748b",
  line: "#d8dee7",
  teal: "#0f766e",
  tealSoft: "#d9f0ee",
  blue: "#2563eb",
  blueSoft: "#dfe9ff",
  amber: "#b45309",
  amberSoft: "#fff1d7",
  rose: "#be123c",
  roseSoft: "#ffe4ea",
  green: "#15803d",
  grid: "#eef2f6",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fmtNumber(value, decimals = 0) {
  return Number(value).toLocaleString("en-HK", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function fmtMoney(value, decimals = 0) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}HK$${fmtNumber(abs / 1_000_000, 1)}m`;
  if (abs >= 1_000) return `${sign}HK$${fmtNumber(abs / 1_000, 1)}k`;
  return `${sign}HK$${fmtNumber(abs, decimals)}`;
}

function fmtPct(value, decimals = 1) {
  return `${fmtNumber(value * 100, decimals)}%`;
}

function updateControlOutputs() {
  Object.keys(CONTROL_META).forEach((id) => {
    const input = $(`#${id}`);
    const output = $(`#${id}Out`);
    if (!input || !output) return;
    const meta = CONTROL_META[id];
    if (id === "eventMonth") {
      output.textContent = Number(input.value) === 0 ? "No claim" : `Month ${input.value}`;
      return;
    }
    const number = Number(input.value);
    output.textContent = `${meta.prefix || ""}${fmtNumber(number, meta.decimals)}${meta.suffix || ""}`;
  });
}

function syncDependentControls() {
  const termInput = $("#termMonths");
  const eventInput = $("#eventMonth");
  if (termInput && eventInput) {
    const term = Number(termInput.value);
    eventInput.max = String(term);
    if (Number(eventInput.value) > term) eventInput.value = String(term);
  }

  const z0Input = $("#thresholdStart");
  const z1Input = $("#thresholdFull");
  if (z0Input && z1Input) {
    const z0 = Number(z0Input.value);
    z1Input.min = String(z0 + 1);
    if (Number(z1Input.value) <= z0) z1Input.value = String(z0 + 1);
  }
}

function readInputs() {
  const values = {};
  Object.keys(DEFAULTS).forEach((id) => {
    const input = $(`#${id}`);
    if (!input) return;
    values[id] = input.type === "checkbox" ? input.checked : Number(input.value);
  });
  if (values.thresholdFull <= values.thresholdStart) {
    values.thresholdFull = values.thresholdStart + 1;
  }
  values.termYears = values.termMonths / 12;
  values.discountFactor = Math.exp(-(values.discountRate / 100) * values.termYears);
  values.totalLoad = clamp((values.riskLoad + values.expenseLoad + values.profitLoad) / 100, 0, 0.86);
  return values;
}

function normalPdf(x, mean, sd) {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

function payoutFactor(z, z0, z1) {
  return clamp((z - z0) / (z1 - z0), 0, 1);
}

function expectedPayoutFactor(inputs) {
  const { thresholdStart: z0, thresholdFull: z1, indexMean: mean, indexVol: sd } = inputs;
  const min = Math.max(0, mean - 5 * sd);
  const max = mean + 5 * sd;
  const steps = 360;
  const dx = (max - min) / steps;
  let weighted = 0;
  let triggerProb = 1 - normalCdf((z0 - mean) / sd);

  for (let i = 0; i <= steps; i += 1) {
    const z = min + i * dx;
    const weight = i === 0 || i === steps ? 0.5 : 1;
    weighted += weight * payoutFactor(z, z0, z1) * normalPdf(z, mean, sd) * dx;
  }

  triggerProb = Math.max(triggerProb, 0.0001);
  return clamp(weighted / triggerProb, 0, 1);
}

function makeRng(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromInputs(inputs) {
  const source = [
    inputs.lambda,
    inputs.termMonths,
    inputs.payout,
    inputs.policies,
    inputs.thresholdStart,
    inputs.thresholdFull,
    inputs.indexMean,
    inputs.indexVol,
    inputs.affectedShare,
    inputs.retentionM,
    inputs.reinsuranceM,
    inputs.catBondM,
  ].join("|");
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function poisson(lambda, rng) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= rng();
  } while (product > limit);
  return count - 1;
}

function sampleNormal(mean, sd, rng) {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const radius = Math.sqrt(-2 * Math.log(u1));
  return mean + sd * radius * Math.cos(2 * Math.PI * u2);
}

function sampleConditionalFactor(inputs, rng) {
  const z0 = inputs.thresholdStart;
  const z1 = inputs.thresholdFull;
  let z = z0;
  for (let i = 0; i < 24; i += 1) {
    z = sampleNormal(inputs.indexMean, inputs.indexVol, rng);
    if (z >= z0) break;
  }
  if (z < z0) z = z0 + rng() * (z1 - z0) * 0.35;
  return payoutFactor(z, z0, z1);
}

function netAfterLayers(loss, inputs) {
  const retention = inputs.retentionM * 1_000_000;
  const riLimit = inputs.reinsuranceM * 1_000_000;
  const catLimit = inputs.catBondM * 1_000_000;
  const riCeded = Math.min(Math.max(loss - retention, 0), riLimit);
  const catCeded = Math.min(Math.max(loss - retention - riLimit, 0), catLimit);
  return {
    net: loss - riCeded - catCeded,
    riCeded,
    catCeded,
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const index = clamp(Math.ceil(q * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[index];
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculate() {
  const inputs = readInputs();
  const expectedFactor = expectedPayoutFactor(inputs);
  const lambdaTerm = inputs.lambda * inputs.termYears;
  const triggerProbability = 1 - Math.exp(-lambdaTerm);
  const expectedPayoutPerTrigger = inputs.payout * expectedFactor;
  const frequencyBasis = inputs.multiTrigger ? lambdaTerm : triggerProbability;
  const purePremium = frequencyBasis * expectedPayoutPerTrigger * inputs.discountFactor;
  const grossPremium = purePremium / (1 - inputs.totalLoad);
  const portfolioPremium = grossPremium * inputs.policies;
  const portfolioExpectedLoss = purePremium * inputs.policies;
  const loadPool = Math.max(grossPremium - purePremium, 0);
  const loadSum = Math.max(inputs.riskLoad + inputs.expenseLoad + inputs.profitLoad, 1);
  const pricing = {
    inputs,
    expectedFactor,
    triggerProbability,
    expectedPayoutPerTrigger,
    purePremium,
    grossPremium,
    portfolioPremium,
    portfolioExpectedLoss,
    riskLoadAmount: loadPool * (inputs.riskLoad / loadSum),
    expenseLoadAmount: loadPool * (inputs.expenseLoad / loadSum),
    profitLoadAmount: loadPool * (inputs.profitLoad / loadSum),
    lossRatio: grossPremium > 0 ? purePremium / grossPremium : 0,
  };

  return {
    ...pricing,
    capital: simulateCapital(pricing),
    ifrs: buildIfrsSchedule(pricing),
  };
}

function simulateCapital(pricing) {
  const { inputs } = pricing;
  const rng = makeRng(seedFromInputs(inputs));
  const simulations = 8000;
  const grossLosses = [];
  const netLosses = [];
  let totalRiCeded = 0;
  let totalCatCeded = 0;
  const baseAffectedShare = inputs.affectedShare / 100;
  const lambdaTerm = inputs.lambda * inputs.termYears;

  for (let year = 0; year < simulations; year += 1) {
    const eventCount = inputs.multiTrigger
      ? poisson(lambdaTerm, rng)
      : rng() < 1 - Math.exp(-lambdaTerm)
        ? 1
        : 0;
    let grossLoss = 0;
    for (let event = 0; event < eventCount; event += 1) {
      const factor = sampleConditionalFactor(inputs, rng);
      const concentrationNoise = (rng() - 0.5) * (1 - baseAffectedShare) * 0.7;
      const affectedShare = clamp(baseAffectedShare + concentrationNoise, 0.08, 1);
      grossLoss += inputs.policies * affectedShare * inputs.payout * factor;
    }
    const layered = netAfterLayers(grossLoss, inputs);
    grossLosses.push(grossLoss);
    netLosses.push(layered.net);
    totalRiCeded += layered.riCeded;
    totalCatCeded += layered.catCeded;
  }

  const grossSorted = [...grossLosses].sort((a, b) => a - b);
  const netSorted = [...netLosses].sort((a, b) => a - b);
  const grossMean = average(grossLosses);
  const netMean = average(netLosses);
  const grossVar995 = quantile(grossSorted, 0.995);
  const netVar99 = quantile(netSorted, 0.99);
  const netVar995 = quantile(netSorted, 0.995);
  const tail = netSorted.filter((value) => value >= netVar995);
  const netTvar995 = average(tail);

  return {
    grossLosses,
    netLosses,
    grossSorted,
    netSorted,
    grossMean,
    netMean,
    grossVar995,
    netVar99,
    netVar995,
    netTvar995,
    economicCapital: Math.max(netVar995 - netMean, 0),
    avgRiCeded: totalRiCeded / simulations,
    avgCatCeded: totalCatCeded / simulations,
  };
}

function buildIfrsSchedule(pricing) {
  const { inputs, portfolioPremium, expectedPayoutPerTrigger } = pricing;
  const months = inputs.termMonths;
  const monthlyRevenue = portfolioPremium / months;
  const eventMonth = clamp(inputs.eventMonth, 0, months);
  const claim = eventMonth === 0 ? 0 : inputs.policies * (inputs.affectedShare / 100) * expectedPayoutPerTrigger;
  const rows = [];
  let lrc = portfolioPremium;
  let totalRevenue = 0;
  let totalClaims = 0;

  for (let month = 1; month <= months; month += 1) {
    const revenue = monthlyRevenue;
    const claims = month === eventMonth ? claim : 0;
    lrc = Math.max(lrc - revenue, 0);
    totalRevenue += revenue;
    totalClaims += claims;
    rows.push({ month, revenue, claims, lrc });
  }

  return {
    rows,
    initialLrc: portfolioPremium,
    totalRevenue,
    totalClaims,
    serviceResult: totalRevenue - totalClaims,
    onerous: totalRevenue - totalClaims < 0,
  };
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function clearChart(canvas) {
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawAxes(ctx, plot, yTicks = 4) {
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();

  ctx.strokeStyle = COLORS.grid;
  for (let i = 1; i <= yTicks; i += 1) {
    const y = plot.y + (plot.h / yTicks) * (i - 1);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
  }
}

function drawPayoutChart(model) {
  const canvas = $("#payoutCanvas");
  const { ctx, width, height } = clearChart(canvas);
  const inputs = model.inputs;
  const plot = { x: 48, y: 22, w: width - 68, h: height - 62 };
  const zMin = Math.max(0, inputs.thresholdStart - 45);
  const zMax = inputs.thresholdFull + 55;
  const xFor = (z) => plot.x + ((z - zMin) / (zMax - zMin)) * plot.w;
  const yForFactor = (f) => plot.y + plot.h - f * plot.h;
  const densityMax = normalPdf(inputs.indexMean, inputs.indexMean, inputs.indexVol);
  const yForDensity = (d) => plot.y + plot.h - (d / densityMax) * plot.h * 0.55;

  drawAxes(ctx, plot);

  ctx.fillStyle = COLORS.blueSoft;
  ctx.beginPath();
  ctx.moveTo(xFor(zMin), plot.y + plot.h);
  for (let i = 0; i <= 160; i += 1) {
    const z = zMin + ((zMax - zMin) * i) / 160;
    ctx.lineTo(xFor(z), yForDensity(normalPdf(z, inputs.indexMean, inputs.indexVol)));
  }
  ctx.lineTo(xFor(zMax), plot.y + plot.h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = COLORS.teal;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 160; i += 1) {
    const z = zMin + ((zMax - zMin) * i) / 160;
    const x = xFor(z);
    const y = yForFactor(payoutFactor(z, inputs.thresholdStart, inputs.thresholdFull));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  [
    { z: inputs.thresholdStart, label: "Z0", color: COLORS.amber },
    { z: inputs.thresholdFull, label: "Z1", color: COLORS.rose },
  ].forEach((item) => {
    const x = xFor(item.z);
    ctx.strokeStyle = item.color;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = item.color;
    ctx.font = "700 12px sans-serif";
    ctx.fillText(item.label, x + 6, plot.y + 16);
  });

  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 12px sans-serif";
  ctx.fillText("0%", plot.x - 34, yForFactor(0) + 4);
  ctx.fillText("100%", plot.x - 42, yForFactor(1) + 4);
  ctx.fillText(`${fmtNumber(zMin, 0)}`, plot.x, plot.y + plot.h + 26);
  ctx.fillText(`${fmtNumber(zMax, 0)}`, plot.x + plot.w - 26, plot.y + plot.h + 26);
}

function drawPremiumChart(model) {
  const canvas = $("#premiumCanvas");
  const { ctx, width, height } = clearChart(canvas);
  const plot = { x: 44, y: 24, w: width - 64, h: height - 72 };
  const bars = [
    { label: "EPV", value: model.purePremium, color: COLORS.teal },
    { label: "Risk", value: model.riskLoadAmount, color: COLORS.amber },
    { label: "Expense", value: model.expenseLoadAmount, color: COLORS.blue },
    { label: "Profit", value: model.profitLoadAmount, color: COLORS.green },
  ];
  const max = Math.max(model.grossPremium, 1);
  const gap = 12;
  const barW = (plot.w - gap * (bars.length - 1)) / bars.length;

  drawAxes(ctx, plot);

  bars.forEach((bar, index) => {
    const h = (bar.value / max) * plot.h;
    const x = plot.x + index * (barW + gap);
    const y = plot.y + plot.h - h;
    ctx.fillStyle = bar.color;
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 12px sans-serif";
    ctx.fillText(bar.label, x, plot.y + plot.h + 24);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 11px sans-serif";
    ctx.fillText(fmtMoney(bar.value), x, Math.max(plot.y + 14, y - 8));
  });

  ctx.strokeStyle = COLORS.rose;
  ctx.lineWidth = 2;
  const grossY = plot.y + plot.h - (model.grossPremium / max) * plot.h;
  ctx.beginPath();
  ctx.moveTo(plot.x, grossY);
  ctx.lineTo(plot.x + plot.w, grossY);
  ctx.stroke();
  ctx.fillStyle = COLORS.rose;
  ctx.font = "800 12px sans-serif";
  ctx.fillText(`Gross ${fmtMoney(model.grossPremium)}`, plot.x + 4, grossY - 8);
}

function histogram(values, bucketCount, maxValue) {
  const buckets = new Array(bucketCount).fill(0);
  if (maxValue <= 0) return buckets;
  values.forEach((value) => {
    const index = clamp(Math.floor((value / maxValue) * bucketCount), 0, bucketCount - 1);
    buckets[index] += 1;
  });
  return buckets;
}

function drawLossChart(model) {
  const canvas = $("#lossCanvas");
  const { ctx, width, height } = clearChart(canvas);
  const capital = model.capital;
  const plot = { x: 54, y: 24, w: width - 82, h: height - 70 };
  const maxValue = Math.max(capital.grossVar995, capital.netVar995, 1) * 1.15;
  const bucketCount = 36;
  const grossBuckets = histogram(capital.grossLosses, bucketCount, maxValue);
  const netBuckets = histogram(capital.netLosses, bucketCount, maxValue);
  const maxBucket = Math.max(...grossBuckets, ...netBuckets, 1);
  const barW = plot.w / bucketCount;

  drawAxes(ctx, plot);

  grossBuckets.forEach((count, index) => {
    const h = (count / maxBucket) * plot.h;
    const x = plot.x + index * barW;
    ctx.fillStyle = "rgba(37, 99, 235, 0.28)";
    ctx.fillRect(x, plot.y + plot.h - h, Math.max(1, barW - 1), h);
  });

  netBuckets.forEach((count, index) => {
    const h = (count / maxBucket) * plot.h;
    const x = plot.x + index * barW;
    ctx.fillStyle = "rgba(15, 118, 110, 0.55)";
    ctx.fillRect(x, plot.y + plot.h - h, Math.max(1, barW - 1), h);
  });

  [
    { value: capital.grossVar995, label: "Gross 99.5%", color: COLORS.blue },
    { value: capital.netVar995, label: "Net 99.5%", color: COLORS.rose },
  ].forEach((marker, index) => {
    const x = plot.x + (marker.value / maxValue) * plot.w;
    ctx.strokeStyle = marker.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(index === 0 ? [5, 5] : []);
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = marker.color;
    ctx.font = "800 12px sans-serif";
    ctx.fillText(marker.label, Math.min(x + 6, plot.x + plot.w - 90), plot.y + 16 + index * 18);
  });

  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 12px sans-serif";
  ctx.fillText("Gross", plot.x + 8, plot.y + plot.h + 26);
  ctx.fillStyle = COLORS.teal;
  ctx.fillText("Net", plot.x + 70, plot.y + plot.h + 26);
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(fmtMoney(maxValue), plot.x + plot.w - 62, plot.y + plot.h + 26);
}

function drawLayerChart(model) {
  const canvas = $("#layerCanvas");
  const { ctx, width, height } = clearChart(canvas);
  const inputs = model.inputs;
  const capital = model.capital;
  const plot = { x: 34, y: 42, w: width - 58, h: 64 };
  const loss = capital.grossVar995;
  const retention = Math.min(loss, inputs.retentionM * 1_000_000);
  const ri = Math.min(Math.max(loss - retention, 0), inputs.reinsuranceM * 1_000_000);
  const cat = Math.min(Math.max(loss - retention - ri, 0), inputs.catBondM * 1_000_000);
  const uncovered = Math.max(loss - retention - ri - cat, 0);
  const max = Math.max(loss, 1);
  const segments = [
    { label: "Retention", value: retention, color: COLORS.teal },
    { label: "Reinsurance", value: ri, color: COLORS.blue },
    { label: "Cat Bond", value: cat, color: COLORS.amber },
    { label: "Tail gap", value: uncovered, color: COLORS.rose },
  ];
  let x = plot.x;

  segments.forEach((segment) => {
    const w = (segment.value / max) * plot.w;
    ctx.fillStyle = segment.color;
    ctx.fillRect(x, plot.y, w, plot.h);
    if (w > 44) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 12px sans-serif";
      ctx.fillText(segment.label, x + 8, plot.y + 25);
      ctx.fillText(fmtMoney(segment.value), x + 8, plot.y + 45);
    }
    x += w;
  });

  ctx.strokeStyle = COLORS.line;
  ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

  const legendY = plot.y + plot.h + 38;
  segments.forEach((segment, index) => {
    const lx = plot.x + (index % 2) * 150;
    const ly = legendY + Math.floor(index / 2) * 30;
    ctx.fillStyle = segment.color;
    ctx.fillRect(lx, ly - 10, 12, 12);
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 12px sans-serif";
    ctx.fillText(`${segment.label} ${fmtMoney(segment.value)}`, lx + 18, ly);
  });
}

function drawIfrsChart(model) {
  const canvas = $("#ifrsCanvas");
  const { ctx, width, height } = clearChart(canvas);
  const rows = model.ifrs.rows;
  const plot = { x: 54, y: 24, w: width - 82, h: height - 72 };
  const maxValue = Math.max(...rows.map((row) => row.revenue), ...rows.map((row) => row.claims), model.ifrs.initialLrc, 1);
  const barGroup = plot.w / rows.length;
  const barW = Math.max(6, barGroup * 0.28);

  drawAxes(ctx, plot);

  rows.forEach((row, index) => {
    const x = plot.x + index * barGroup + barGroup * 0.18;
    const revH = (row.revenue / maxValue) * plot.h;
    const claimH = (row.claims / maxValue) * plot.h;
    ctx.fillStyle = COLORS.teal;
    ctx.fillRect(x, plot.y + plot.h - revH, barW, revH);
    ctx.fillStyle = COLORS.rose;
    ctx.fillRect(x + barW + 3, plot.y + plot.h - claimH, barW, claimH);
  });

  ctx.strokeStyle = COLORS.blue;
  ctx.lineWidth = 3;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = plot.x + index * barGroup + barGroup / 2;
    const y = plot.y + plot.h - (row.lrc / maxValue) * plot.h;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 12px sans-serif";
  ctx.fillText("Revenue", plot.x + 6, plot.y + plot.h + 28);
  ctx.fillStyle = COLORS.rose;
  ctx.fillText("Claim", plot.x + 76, plot.y + plot.h + 28);
  ctx.fillStyle = COLORS.blue;
  ctx.fillText("LRC", plot.x + 128, plot.y + plot.h + 28);
}

function drawAlmChart(model) {
  const canvas = $("#almCanvas");
  const { ctx, width, height } = clearChart(canvas);
  const inputs = model.inputs;
  const capital = model.capital;
  const requiredLiquidity = capital.netVar99 * (inputs.liquidityBuffer / 100);
  const plot = { x: 58, y: 28, w: width - 94, h: height - 82 };
  const bars = [
    { label: "99% net loss", value: capital.netVar99, color: COLORS.rose },
    { label: "With buffer", value: requiredLiquidity, color: COLORS.amber },
    { label: "Gross premium", value: model.portfolioPremium, color: COLORS.teal },
    { label: "Economic capital", value: capital.economicCapital, color: COLORS.blue },
  ];
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const gap = 16;
  const barW = (plot.w - gap * (bars.length - 1)) / bars.length;

  drawAxes(ctx, plot);

  bars.forEach((bar, index) => {
    const h = (bar.value / max) * plot.h;
    const x = plot.x + index * (barW + gap);
    const y = plot.y + plot.h - h;
    ctx.fillStyle = bar.color;
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 12px sans-serif";
    ctx.fillText(bar.label, x, plot.y + plot.h + 26);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 11px sans-serif";
    ctx.fillText(fmtMoney(bar.value), x, Math.max(plot.y + 14, y - 8));
  });
}

function drawAssetChart(model) {
  const canvas = $("#assetCanvas");
  const { ctx, width, height } = clearChart(canvas);
  const stable = model.inputs.stablecoinShare / 100;
  const cash = 0.42;
  const mmf = Math.max(0, 0.38 - stable / 2);
  const bills = Math.max(0, 1 - cash - mmf - stable);
  const segments = [
    { label: "Cash", value: cash, color: COLORS.teal },
    { label: "Money market", value: mmf, color: COLORS.blue },
    { label: "T-bills", value: bills, color: COLORS.amber },
    { label: "Stablecoin", value: stable, color: COLORS.rose },
  ];
  const cx = width / 2;
  const cy = height / 2 - 8;
  const radius = Math.min(width, height) * 0.28;
  let start = -Math.PI / 2;

  segments.forEach((segment) => {
    const end = start + segment.value * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = segment.color;
    ctx.fill();
    start = end;
  });

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.ink;
  ctx.font = "800 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Short duration", cx, cy + 5);
  ctx.textAlign = "start";

  segments.forEach((segment, index) => {
    const x = 22 + (index % 2) * (width / 2 - 10);
    const y = height - 58 + Math.floor(index / 2) * 24;
    ctx.fillStyle = segment.color;
    ctx.fillRect(x, y - 10, 12, 12);
    ctx.fillStyle = COLORS.ink;
    ctx.font = "800 12px sans-serif";
    ctx.fillText(`${segment.label} ${fmtPct(segment.value, 0)}`, x + 18, y);
  });
}

function setRows(tbody, rows) {
  tbody.innerHTML = rows
    .map(([label, value, note]) => {
      const third = note ? `<td>${note}</td>` : "";
      return `<tr><td>${label}</td><td>${value}</td>${third}</tr>`;
    })
    .join("");
}

function renderTables(model) {
  const inputs = model.inputs;
  const capital = model.capital;
  const ifrs = model.ifrs;
  const theta = inputs.totalLoad;
  setRows($("#pricingRows"), [
    ["Trigger probability p", fmtPct(model.triggerProbability), '<span class="math">1 - e<sup>-λτ</sup></span>'],
    ["Expected payout per trigger", fmtMoney(model.expectedPayoutPerTrigger), `<span class="math">X · E[g(Z)|trigger]</span> = ${fmtPct(model.expectedFactor)} × X`],
    [
      "Pure premium EPV(L)",
      fmtMoney(model.purePremium),
      inputs.multiTrigger
        ? '<span class="math">λτ · X · E[g(Z)|trigger] · v<sub>τ</sub></span>'
        : '<span class="math">p · X · E[g(Z)|trigger] · v<sub>τ</sub></span>',
    ],
    ["Total load θ", fmtPct(theta), "Risk + expense + profit"],
    ["Gross premium Pgross", fmtMoney(model.grossPremium), '<span class="math">P<sub>pure</sub>/(1 - θ)</span>'],
    ["Portfolio expected loss", fmtMoney(model.portfolioExpectedLoss), `${fmtNumber(inputs.policies)} policies`],
    ["Portfolio gross premium", fmtMoney(model.portfolioPremium), "Initial LRC under simplified PAA"],
  ]);

  setRows($("#capitalRows"), [
    ["Gross 99.5% VaR", fmtMoney(capital.grossVar995)],
    ["Net 99.0% VaR", fmtMoney(capital.netVar99)],
    ["Net 99.5% VaR", fmtMoney(capital.netVar995)],
    ["Net 99.5% TVaR", fmtMoney(capital.netTvar995)],
    ["Economic capital", fmtMoney(capital.economicCapital)],
    ["Average reinsurance recovery", fmtMoney(capital.avgRiCeded)],
    ["Average Cat Bond recovery", fmtMoney(capital.avgCatCeded)],
  ]);

  setRows($("#ifrsSummaryRows"), [
    ["Measurement basis", "Simplified PAA illustration"],
    ["Initial LRC", fmtMoney(ifrs.initialLrc)],
    ["Insurance revenue", fmtMoney(ifrs.totalRevenue)],
    ["Insurance service expense", fmtMoney(ifrs.totalClaims)],
    ["Insurance service result", fmtMoney(ifrs.serviceResult)],
    ["Onerous group flag", ifrs.onerous ? "Watch" : "Not triggered"],
  ]);

  $("#ifrsRows").innerHTML = ifrs.rows
    .map(
      (row) => `<tr>
        <td>${row.month}</td>
        <td>${fmtMoney(row.revenue)}</td>
        <td>${fmtMoney(row.claims)}</td>
        <td>${fmtMoney(row.lrc)}</td>
      </tr>`,
    )
    .join("");

  const stablecoinAsset = capital.netVar99 * (inputs.liquidityBuffer / 100) * (inputs.stablecoinShare / 100);
  const stablecoinCharge = stablecoinAsset;
  const conservativeCharge = capital.netVar99 * 0.011;
  setRows($("#almRows"), [
    ["99% immediate payout need", fmtMoney(capital.netVar99)],
    ["Liquidity pool after buffer", fmtMoney(capital.netVar99 * (inputs.liquidityBuffer / 100))],
    ["Stablecoin payout pool", fmtMoney(stablecoinAsset)],
    ["Stablecoin RBC charge", fmtMoney(stablecoinCharge)],
    ["Low-risk asset charge", fmtMoney(conservativeCharge)],
    ["Available gross premium", fmtMoney(model.portfolioPremium)],
  ]);
}

function updateBadges(model) {
  $("#expectedFactorBadge").textContent = `E[g(Z)|trigger] ${fmtPct(model.expectedFactor)}`;
  $("#lossRatioBadge").textContent = `Expected loss ratio ${fmtPct(model.lossRatio)}`;

  const coverRatio = model.inputs.retentionM * 1_000_000 + model.inputs.reinsuranceM * 1_000_000 + model.inputs.catBondM * 1_000_000;
  const capitalBadge = $("#capitalBadge");
  const tailGap = Math.max(model.capital.grossVar995 - coverRatio, 0);
  capitalBadge.className = "badge";
  if (tailGap <= 1) {
    capitalBadge.textContent = "Tail covered";
    capitalBadge.classList.add("status-good");
  } else if (tailGap < model.capital.grossVar995 * 0.18) {
    capitalBadge.textContent = "Tail gap";
    capitalBadge.classList.add("status-watch");
  } else {
    capitalBadge.textContent = "High capital strain";
    capitalBadge.classList.add("status-risk");
  }

  const ifrsBadge = $("#ifrsBadge");
  ifrsBadge.className = "badge";
  ifrsBadge.textContent = model.ifrs.onerous ? "Onerous watch" : "Simplified PAA";
  ifrsBadge.classList.add(model.ifrs.onerous ? "status-risk" : "status-good");

  const almBadge = $("#almBadge");
  const liquidityNeed = model.capital.netVar99 * (model.inputs.liquidityBuffer / 100);
  almBadge.className = "badge";
  if (model.portfolioPremium + model.capital.economicCapital >= liquidityNeed) {
    almBadge.textContent = "Liquidity sufficient";
    almBadge.classList.add("status-good");
  } else {
    almBadge.textContent = "Liquidity top-up needed";
    almBadge.classList.add("status-watch");
  }
}

function renderMetrics(model) {
  $("#triggerProbability").textContent = fmtPct(model.triggerProbability);
  $("#purePremium").textContent = fmtMoney(model.purePremium);
  $("#grossPremium").textContent = fmtMoney(model.grossPremium);
  $("#netVar").textContent = fmtMoney(model.capital.netVar995);
}

function renderAll() {
  syncDependentControls();
  updateControlOutputs();
  const model = calculate();
  renderMetrics(model);
  updateBadges(model);
  renderTables(model);
  drawPayoutChart(model);
  drawPremiumChart(model);
  drawLossChart(model);
  drawLayerChart(model);
  drawIfrsChart(model);
  drawAlmChart(model);
  drawAssetChart(model);
}

function activateTab(name) {
  $$(".tab-button").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$(".view").forEach((view) => {
    const active = view.id === `view-${name}`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  requestAnimationFrame(renderAll);
}

function resetDefaults() {
  Object.entries(DEFAULTS).forEach(([id, value]) => {
    const input = $(`#${id}`);
    if (!input) return;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value;
  });
  renderAll();
}

function init() {
  $$("input").forEach((input) => {
    input.addEventListener("input", renderAll);
    input.addEventListener("change", renderAll);
  });
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.view));
  });
  $("#resetBtn").addEventListener("click", resetDefaults);
  window.addEventListener("resize", renderAll);
  renderAll();
}

init();
