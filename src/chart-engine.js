import { getTamilDateShort, getMoonPhase, getTamilMonthsForGregorianMonth } from "./tn-calendar.js";

const CHART_COLORS = [
  "#128c7e",
  "#25d366",
  "#075e54",
  "#34b7f1",
  "#00a884",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function renderDonutChart(categories, formatAmount) {
  if (!categories.length) return "";
  // Sanitize amounts to prevent NaN propagation
  categories = categories.map((c) => ({ ...c, amount: Number(c.amount) || 0 }));
  const total = categories.reduce((s, c) => s + c.amount, 0);
  if (!total || !isFinite(total)) return "";

  const cx = 80,
    cy = 80,
    outerR = 70,
    innerR = 42;
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
      paths.push(
        `<path d="${d}" fill="${color}" class="donut-segment" data-tooltip="${tooltip}"><title>${tooltip}</title></path>`
      );
    }

    legends.push(
      `<div class="donut-legend__item"><span class="donut-legend__dot" style="background:${color}"></span><span class="donut-legend__label">${esc(cat.name)}</span><span class="donut-legend__value">${pct}%</span></div>`
    );
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
  const width = 320,
    height = 160;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Sanitize values to prevent NaN in SVG coordinates
  const sanitized = dataPoints.map((d) => ({ ...d, value: Number(d.value) || 0 }));
  const maxVal = Math.max(...sanitized.map((d) => d.value));
  if (!isFinite(maxVal)) return "";
  const range = maxVal || 1;

  const points = sanitized.map((d, i) => {
    const x = padding.left + (i / (sanitized.length - 1)) * chartW;
    const y = padding.top + chartH - (d.value / range) * chartH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    linePath +
    ` L ${points[points.length - 1].x.toFixed(1)} ${padding.top + chartH} L ${points[0].x.toFixed(1)} ${padding.top + chartH} Z`;

  const gridLines = [];
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = padding.top + (i / gridCount) * chartH;
    gridLines.push(
      `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--border-color)" stroke-width="0.5" stroke-dasharray="3,3"/>`
    );
  }

  const labels = points.filter(
    (_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1
  );
  const xLabels = labels.map(
    (p) =>
      `<text x="${p.x.toFixed(1)}" y="${height - 4}" text-anchor="middle" class="line-chart__x-label">${esc(p.label)}</text>`
  );

  const dots = points.map(
    (p) =>
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" class="line-chart__dot" tabindex="0" aria-label="${esc(p.label)}: ${esc(formatAmount(p.value))}"><title>${esc(p.label)}: ${esc(formatAmount(p.value))}</title></circle>`
  );

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
  // Sanitize to prevent NaN in bar heights
  months = months.map((m) => ({ ...m, income: Number(m.income) || 0, expense: Number(m.expense) || 0 }));

  const maxVal = Math.max(...months.flatMap((m) => [m.income, m.expense]));
  if (!maxVal || !isFinite(maxVal)) return "";

  const bars = months
    .slice(-6)
    .map((m) => {
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
    })
    .join("");

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

/**
 * @param {Array} dailyData — [{day, amount}]
 * @param {string} currentMonth — display label
 * @param {Function} formatAmount
 * @param {number} year
 * @param {number} month
 * @param {boolean} isCurrentMonth
 * @param {Map<string, Array>} [eventMap] — dateKey → [{name, nameTA, type, emoji}]
 */
export function renderDailyHeatmap(dailyData, currentMonth, formatAmount, year, month, isCurrentMonth, eventMap) {
  if (!dailyData.length) return "";

  const maxVal = Math.max(...dailyData.map((d) => Number(d.amount) || 0));
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  // Tamil month subtitle — shows both months if Gregorian month spans two
  const tamilMonths = getTamilMonthsForGregorianMonth(year, month);
  const tamilLine = tamilMonths.label
    ? `<div class="heatmap__tamil-subtitle">${tamilMonths.label} · ${tamilMonths.year}</div>`
    : "";

  const titleBar = `
    <div class="heatmap__header">
      <button class="heatmap__nav-btn" id="heatmapPrevMonth" aria-label="Previous month">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="heatmap__title-block">
        <div class="heatmap__title">${esc(currentMonth)}</div>
        ${tamilLine}
      </div>
      <button class="heatmap__nav-btn" id="heatmapNextMonth" aria-label="Next month" ${isCurrentMonth ? "disabled" : ""}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  `;

  if (maxVal === 0 && (!eventMap || eventMap.size === 0)) {
    return `<div class="daily-heatmap">${titleBar}<p class="heatmap__empty">No spending recorded this month yet.</p></div>`;
  }

  const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const headers = weekdays.map((d) => `<div class="heatmap__wday">${d}</div>`).join("");

  const startOffset = new Date(year, month - 1, 1).getDay();
  const blanks = Array(startOffset).fill('<div class="heatmap__cell heatmap__cell--blank"></div>').join("");

  const safeMax = maxVal || 1;
  const today = new Date();
  const todayDk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Build cells + collect moon phase days for legend
  const moonDays = [];
  const cells = dailyData
    .map((d) => {
      const intensity = maxVal > 0 ? d.amount / safeMax : 0;
      let level = 0;
      if (intensity > 0) level = 1;
      if (intensity > 0.25) level = 2;
      if (intensity > 0.5) level = 3;
      if (intensity > 0.75) level = 4;

      const dk = `${monthKey}-${String(d.day).padStart(2, "0")}`;
      const tamilShort = getTamilDateShort(dk);
      const moon = getMoonPhase(dk);
      const isToday = dk === todayDk;

      // Collect special moon days for legend
      if (moon.isSpecial) moonDays.push({ day: d.day, moon, isPast: dk < todayDk });

      // Build cell classes
      let cls = `heatmap__cell heatmap__cell--L${level} heatmap__cell--click`;
      if (isToday) cls += " heatmap__cell--today";
      if (moon.phase === "new") cls += " heatmap__cell--amavasai";
      else if (moon.phase === "full") cls += " heatmap__cell--pournami";

      // Festival marker (sanitize type for safe CSS class injection)
      const events = eventMap ? eventMap.get(dk) : null;
      let festDot = "";
      if (events && events.length) {
        const t = (events[0].type || "festival").replace(/[^a-z-]/gi, "");
        cls += ` heatmap__cell--fest heatmap__cell--fest-${t}`;
        festDot = `<i class="heatmap__fdot heatmap__fdot--${t}"></i>`;
      }

      const tips = [`${d.day} ${tamilShort}`];
      if (d.amount) tips.push(formatAmount(d.amount));
      if (moon.isSpecial) tips.push(moon.nameEn);
      if (events?.length) tips.push(events[0].name);
      const tip = esc(tips.join(" · "));

      return (
        `<div class="${cls}" data-heatmap-day="${d.day}" title="${tip}" aria-label="${tip}" role="button" tabindex="0">` +
        `<span class="heatmap__num">${d.day}</span>` +
        `<span class="heatmap__tdate">${tamilShort}</span>` +
        `${festDot}` +
        `</div>`
      );
    })
    .join("");

  // Moon phase legend — Amavasai / Pournami dates
  let moonLegend = "";
  if (moonDays.length) {
    const chips = moonDays.map((p) =>
      `<span class="heatmap__moon-chip heatmap__moon-chip--${p.moon.phase}${p.isPast ? " heatmap__moon-chip--past" : ""}">` +
      `<span class="heatmap__moon-chip-icon">${esc(p.moon.emoji)}</span>` +
      `<span class="heatmap__moon-chip-label">${p.moon.nameTA}</span>` +
      `<span class="heatmap__moon-chip-day">${p.day}${ordinal(p.day)}</span>` +
      `</span>`
    ).join("");
    moonLegend = `<div class="heatmap__moon-legend">${chips}</div>`;
  }

  // Festival chip strip
  let festStrip = "";
  if (eventMap && eventMap.size > 0) {
    const sorted = [...eventMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    const chips = [];
    for (const [dk, evts] of sorted) {
      for (const e of evts) {
        const dayN = Number(dk.slice(8, 10));
        const past = dk < todayDk;
        const safeType = (e.type || "festival").replace(/[^a-z-]/gi, "");
        chips.push(
          `<span class="heatmap__fest-chip heatmap__fest-chip--${safeType}${past ? " heatmap__fest-chip--past" : ""}">` +
          `<span class="heatmap__fest-chip-emoji">${esc(e.emoji || "🎯")}</span>` +
          `<span class="heatmap__fest-chip-body">` +
          `<span class="heatmap__fest-chip-name">${esc(e.nameTA || e.name)}</span>` +
          `<span class="heatmap__fest-chip-date">${dayN}${ordinal(dayN)}</span>` +
          `</span></span>`
        );
      }
    }
    if (chips.length) {
      festStrip = `<div class="heatmap__fest-strip"><div class="heatmap__fest-scroll">${chips.join("")}</div></div>`;
    }
  }

  // Spend intensity scale
  const scale = `
    <div class="heatmap__scale">
      <span>Less</span>
      <i class="heatmap__scale-box heatmap__scale-box--0"></i>
      <i class="heatmap__scale-box heatmap__scale-box--1"></i>
      <i class="heatmap__scale-box heatmap__scale-box--2"></i>
      <i class="heatmap__scale-box heatmap__scale-box--3"></i>
      <i class="heatmap__scale-box heatmap__scale-box--4"></i>
      <span>More</span>
    </div>`;

  return `
    <div class="daily-heatmap">
      ${titleBar}
      <div class="heatmap__grid">${headers}${blanks}${cells}</div>
      ${scale}
      ${moonLegend}
      ${festStrip}
      <div class="heatmap__day-detail" id="heatmapDayDetail" hidden></div>
    </div>
  `;
}

export function renderDailyBarChart(dailyPoints, formatAmount, todayDay, year, month, dailyBudget) {
  if (!dailyPoints.length) return "";

  // Only show days up to today — no empty future bars; sanitize values
  const visibleDays = dailyPoints
    .filter((d) => d.day <= todayDay)
    .map((d) => ({ ...d, value: Number(d.value) || 0 }));
  if (!visibleDays.length) return "";

  const maxVal = Math.max(...visibleDays.map((d) => d.value), Number(dailyBudget) || 0);
  if (!maxVal || !isFinite(maxVal)) return "";

  const padding = { top: 14, right: 8, bottom: 36, left: 8 };
  const width = 420,
    height = 160;
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const barGap = visibleDays.length > 15 ? 1 : 3;
  const barWidth = Math.max(6, (chartW - barGap * visibleDays.length) / visibleDays.length);

  const gridLines = [];
  for (let i = 0; i <= 3; i++) {
    const y = padding.top + (i / 3) * chartH;
    gridLines.push(
      `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--border-color)" stroke-width="0.5" stroke-dasharray="3,3"/>`
    );
  }

  // Budget reference line
  let budgetLine = "";
  if (dailyBudget > 0) {
    const budgetY = padding.top + chartH - (dailyBudget / maxVal) * chartH;
    budgetLine = `
      <line x1="${padding.left}" y1="${budgetY.toFixed(1)}" x2="${width - padding.right}" y2="${budgetY.toFixed(1)}" stroke="var(--color-warning)" stroke-width="1" stroke-dasharray="5,3" opacity="0.7"/>
      <text x="${width - padding.right}" y="${(budgetY - 4).toFixed(1)}" text-anchor="end" class="daily-bar__budget-label">${esc(formatAmount(dailyBudget))}/day</text>
    `;
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const bars = visibleDays.map((d, i) => {
    const barH = maxVal > 0 ? (d.value / maxVal) * chartH : 0;
    const x = padding.left + i * (barWidth + barGap);
    const y = padding.top + chartH - barH;
    const isToday = d.day === todayDay;
    const overBudget = dailyBudget > 0 && d.value > dailyBudget;
    const cls = isToday ? "daily-bar--today" : overBudget ? "daily-bar--over" : d.value === 0 ? "daily-bar--zero" : "";
    const date = new Date(year, month - 1, d.day);
    const dayName = dayNames[date.getDay()];
    const amountStr = d.value > 0 ? formatAmount(d.value) : "No spend";
    const budgetNote = overBudget ? ` (over budget!)` : "";
    const tooltip = `${dayName}, ${d.day} — ${esc(amountStr)}${budgetNote}`;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, barH).toFixed(1)}" rx="2" class="daily-bar ${cls}" aria-label="${tooltip}"><title>${tooltip}</title></rect>`;
  });

  // Label every day if ≤10 days, else every 3rd/5th + day 1 + today
  const labelInterval = visibleDays.length <= 10 ? 1 : visibleDays.length <= 20 ? 3 : 5;
  const labels = visibleDays
    .filter((d) => d.day === 1 || d.day % labelInterval === 0 || d.day === todayDay)
    .map((d) => {
      const idx = visibleDays.findIndex((v) => v.day === d.day);
      const x = padding.left + idx * (barWidth + barGap) + barWidth / 2;
      const date = new Date(year, month - 1, d.day);
      const dayName = dayNames[date.getDay()].charAt(0);
      const isToday = d.day === todayDay;
      const cls = isToday ? "daily-bar__label--today" : "daily-bar__label";
      return `<text x="${x.toFixed(1)}" y="${height - 14}" text-anchor="middle" class="${cls}">${d.day}</text><text x="${x.toFixed(1)}" y="${height - 4}" text-anchor="middle" class="daily-bar__day-name">${dayName}</text>`;
    });

  return `
    <div class="daily-bar-chart">
      <svg viewBox="0 0 ${width} ${height}" class="daily-bar-chart__svg" role="img" aria-label="Daily spending bar chart" preserveAspectRatio="xMidYMid meet">
        ${gridLines.join("")}
        ${budgetLine}
        ${bars.join("")}
        ${labels.join("")}
      </svg>
    </div>
  `;
}
