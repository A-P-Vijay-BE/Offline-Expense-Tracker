const CHART_COLORS = [
  "#128c7e", "#25d366", "#075e54", "#34b7f1", "#00a884",
  "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4",
];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function renderDonutChart(categories, formatAmount) {
  if (!categories.length) return "";
  const total = categories.reduce((s, c) => s + c.amount, 0);
  if (total === 0) return "";

  const cx = 80, cy = 80, outerR = 70, innerR = 42;
  let currentAngle = 0;
  const paths = [];
  const legends = [];

  const MAX_SLICES = 7;
  let displayCategories = categories;
  if (categories.length > MAX_SLICES + 1) {
    const top = categories.slice(0, MAX_SLICES);
    const otherAmount = categories.slice(MAX_SLICES).reduce((s, c) => s + c.amount, 0);
    displayCategories = [...top, { name: "Other", amount: otherAmount }];
  }

  displayCategories.forEach((cat, i) => {
    const slice = (cat.amount / total) * 360;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const pct = Math.round((cat.amount / total) * 100);

    if (slice > 0.5) {
      const outerStart = polarToCartesian(cx, cy, outerR, currentAngle);
      const outerEnd = polarToCartesian(cx, cy, outerR, currentAngle + slice);
      const innerEnd = polarToCartesian(cx, cy, innerR, currentAngle + slice);
      const innerStart = polarToCartesian(cx, cy, innerR, currentAngle);
      const largeArc = slice > 180 ? 1 : 0;

      const d = [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerR} ${outerR} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
        "Z",
      ].join(" ");

      const tooltip = `${esc(cat.name)}: ${esc(formatAmount(cat.amount))} (${pct}%)`;
      paths.push(`<path d="${d}" fill="${color}" class="donut-segment" data-tooltip="${tooltip}"><title>${tooltip}</title></path>`);
    }

    legends.push(`<div class="donut-legend__item"><span class="donut-legend__dot" style="background:${color}"></span><span class="donut-legend__label">${esc(cat.name)}</span><span class="donut-legend__value">${pct}%</span></div>`);
    currentAngle += slice;
  });

  const centerText = esc(formatAmount(total));

  return `
    <div class="donut-chart">
      <div class="donut-chart__svg-wrap">
        <svg viewBox="0 0 160 160" class="donut-chart__svg" role="img" aria-label="Category breakdown donut chart">
          ${paths.join("")}
          <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-chart__total-label">Total</text>
          <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="donut-chart__total-value">${centerText}</text>
        </svg>
      </div>
      <div class="donut-legend">${legends.join("")}</div>
    </div>
  `;
}

export function renderLineChart(dataPoints, formatAmount) {
  if (dataPoints.length < 2) return "";

  const padding = { top: 20, right: 16, bottom: 32, left: 12 };
  const width = 320, height = 160;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(...dataPoints.map((d) => d.value));
  const range = maxVal || 1;

  const points = dataPoints.map((d, i) => {
    const x = padding.left + (i / (dataPoints.length - 1)) * chartW;
    const y = padding.top + chartH - (d.value / range) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = linePath + ` L ${points[points.length - 1].x.toFixed(1)} ${padding.top + chartH} L ${points[0].x.toFixed(1)} ${padding.top + chartH} Z`;

  const gridLines = [];
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = padding.top + (i / gridCount) * chartH;
    gridLines.push(`<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--border-color)" stroke-width="0.5" stroke-dasharray="3,3"/>`);
  }

  const labels = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1);
  const xLabels = labels.map((p) => `<text x="${p.x.toFixed(1)}" y="${height - 4}" text-anchor="middle" class="line-chart__x-label">${esc(p.label)}</text>`);

  const dots = points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" class="line-chart__dot" tabindex="0" aria-label="${esc(p.label)}: ${esc(formatAmount(p.value))}"><title>${esc(p.label)}: ${esc(formatAmount(p.value))}</title></circle>`);

  return `
    <div class="line-chart">
      <svg viewBox="0 0 ${width} ${height}" class="line-chart__svg" role="img" aria-label="Monthly spending line chart" preserveAspectRatio="xMidYMid meet">
        ${gridLines.join("")}
        <path d="${areaPath}" class="line-chart__area"/>
        <path d="${linePath}" class="line-chart__line"/>
        ${dots.join("")}
        ${xLabels.join("")}
      </svg>
    </div>
  `;
}

export function renderIncomeExpenseBar(months, formatAmount) {
  if (!months.length) return "";

  const maxVal = Math.max(...months.flatMap((m) => [m.income, m.expense]));
  if (maxVal === 0) return "";

  const bars = months.slice(-6).map((m) => {
    const incH = Math.max(3, Math.round((m.income / maxVal) * 100));
    const expH = Math.max(3, Math.round((m.expense / maxVal) * 100));
    return `
      <div class="ie-bar__group">
        <div class="ie-bar__col">
          <div class="ie-bar__bar ie-bar__bar--income" style="height:${incH}%" title="Income: ${esc(formatAmount(m.income))}">
            <span class="ie-bar__value">${esc(formatAmount(m.income))}</span>
          </div>
          <div class="ie-bar__bar ie-bar__bar--expense" style="height:${expH}%" title="Expense: ${esc(formatAmount(m.expense))}">
            <span class="ie-bar__value">${esc(formatAmount(m.expense))}</span>
          </div>
        </div>
        <span class="ie-bar__label">${esc(m.label)}</span>
      </div>
    `;
  }).join("");

  return `
    <div class="ie-bar-chart">
      <div class="ie-bar-chart__heading">Income vs Expense</div>
      <div class="ie-bar__legend">
        <span class="ie-bar__legend-item"><span class="ie-bar__legend-dot ie-bar__legend-dot--income"></span>Income</span>
        <span class="ie-bar__legend-item"><span class="ie-bar__legend-dot ie-bar__legend-dot--expense"></span>Expense</span>
      </div>
      <div class="ie-bar__container">${bars}</div>
    </div>
  `;
}

export function renderDailyHeatmap(dailyData, currentMonth, formatAmount) {
  if (!dailyData.length) return "";

  const maxVal = Math.max(...dailyData.map((d) => d.amount));
  if (maxVal === 0) {
    return `
      <div class="daily-heatmap">
        <div class="heatmap__title">Daily Spending — ${esc(currentMonth)}</div>
        <p class="heatmap__empty">No spending recorded this month yet.</p>
      </div>
    `;
  }

  const cells = dailyData.map((d) => {
    const intensity = d.amount / maxVal;
    let level = 0;
    if (intensity > 0) level = 1;
    if (intensity > 0.25) level = 2;
    if (intensity > 0.5) level = 3;
    if (intensity > 0.75) level = 4;
    const tooltip = `Day ${d.day}: ${esc(formatAmount(d.amount))}`;
    return `<div class="heatmap__cell heatmap__cell--${level}" title="${tooltip}" aria-label="${tooltip}"><span class="heatmap__day">${d.day}</span></div>`;
  }).join("");

  return `
    <div class="daily-heatmap">
      <div class="heatmap__title">Daily Spending — ${esc(currentMonth)}</div>
      <div class="heatmap__grid">${cells}</div>
      <div class="heatmap__scale">
        <span>Less</span>
        <div class="heatmap__cell heatmap__cell--0"></div>
        <div class="heatmap__cell heatmap__cell--1"></div>
        <div class="heatmap__cell heatmap__cell--2"></div>
        <div class="heatmap__cell heatmap__cell--3"></div>
        <div class="heatmap__cell heatmap__cell--4"></div>
        <span>More</span>
      </div>
    </div>
  `;
}
