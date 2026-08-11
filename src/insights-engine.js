import { normalizeType, calculateTotalAvailableBalance } from "./balance-engine.js";

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthKey() {
  return localDateKey().slice(0, 7);
}

function getMonthKey(dateKey) {
  return String(dateKey).slice(0, 7);
}

function getDayOfWeek(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function getVisibleDebits(expenses) {
  return expenses.filter((e) => !e.deleted && normalizeType(e.type) === "debit");
}

function getVisibleCredits(expenses) {
  return expenses.filter((e) => !e.deleted && normalizeType(e.type) === "credit");
}

function getMonthlyTotals(debits, monthsBack = 6) {
  const totals = new Map();
  const now = new Date();
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    totals.set(key, 0);
  }
  for (const expense of debits) {
    const mk = getMonthKey(expense.dateKey);
    if (totals.has(mk)) {
      totals.set(mk, totals.get(mk) + Number(expense.amount));
    }
  }
  return totals;
}

function getCategoryTotalsForMonth(debits, monthKey) {
  const totals = new Map();
  for (const expense of debits) {
    if (getMonthKey(expense.dateKey) !== monthKey) continue;
    const cat = expense.category || "Other";
    totals.set(cat, (totals.get(cat) || 0) + Number(expense.amount));
  }
  return totals;
}

function getRollingAverage(debits, category, currentMonth, monthsBack = 3) {
  const now = new Date();
  let total = 0;
  let count = 0;
  for (let i = 1; i <= monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthDebits = debits.filter((e) => getMonthKey(e.dateKey) === mk && e.category === category);
    const sum = monthDebits.reduce((s, e) => s + Number(e.amount), 0);
    if (sum > 0) { total += sum; count++; }
  }
  return count > 0 ? total / count : 0;
}

export function generateInsights(expenses, accounts, budgets, formatMoney) {
  const fmt = formatMoney || formatInsightMoney;
  const insights = [];
  const debits = getVisibleDebits(expenses);
  const credits = getVisibleCredits(expenses);
  const month = currentMonthKey();
  const today = localDateKey();
  const dayOfMonth = new Date().getDate();

  if (debits.length < 5) return insights;

  // ── Category Anomaly Detection ──────────────────────────────────────────
  const currentCategoryTotals = getCategoryTotalsForMonth(debits, month);
  for (const [category, currentSpend] of currentCategoryTotals) {
    const avg = getRollingAverage(debits, category, month, 3);
    if (avg > 0 && currentSpend > avg * 1.5) {
      const percentOver = Math.round(((currentSpend - avg) / avg) * 100);
      insights.push({
        type: "warning",
        icon: "trend-up",
        title: `${category} spending spike`,
        description: `You've spent ${fmt(currentSpend)} on ${category} this month — ${percentOver}% more than your 3-month average of ${fmt(avg)}.`,
        priority: 90 + Math.min(percentOver, 100),
      });
    }
  }

  // ── Monthly Pace / Velocity ─────────────────────────────────────────────
  const monthDebits = debits.filter((e) => getMonthKey(e.dateKey) === month);
  const monthSpent = monthDebits.reduce((s, e) => s + Number(e.amount), 0);
  if (dayOfMonth >= 5 && monthSpent > 0) {
    const dailyRate = monthSpent / dayOfMonth;
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projected = dailyRate * daysInMonth;
    const monthlyTotals = getMonthlyTotals(debits, 4);
    const pastMonths = [...monthlyTotals.entries()].filter(([k]) => k !== month && monthlyTotals.get(k) > 0);
    const avgMonthly = pastMonths.length > 0
      ? pastMonths.reduce((s, [, v]) => s + v, 0) / pastMonths.length
      : 0;

    if (avgMonthly > 0 && projected > avgMonthly * 1.2) {
      insights.push({
        type: "danger",
        icon: "alert",
        title: "On track to overspend",
        description: `At your current pace, you'll spend ${fmt(projected)} this month — above your average of ${fmt(avgMonthly)}.`,
        priority: 85,
      });
    } else if (avgMonthly > 0 && projected < avgMonthly * 0.8) {
      insights.push({
        type: "positive",
        icon: "trend-down",
        title: "Spending well under control",
        description: `Projected spend: ${fmt(projected)} — that's below your average of ${fmt(avgMonthly)}. Keep it up!`,
        priority: 40,
      });
    }
  }

  // ── Weekend vs Weekday Spending ─────────────────────────────────────────
  const last30 = debits.filter((e) => {
    const diff = (new Date(today) - new Date(e.dateKey)) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 30;
  });
  if (last30.length >= 10) {
    let weekendTotal = 0, weekdayTotal = 0, weekendDays = 0, weekdayDays = 0;
    const dayTotals = new Map();
    for (const e of last30) {
      dayTotals.set(e.dateKey, (dayTotals.get(e.dateKey) || 0) + Number(e.amount));
    }
    for (const [dk, total] of dayTotals) {
      const dow = getDayOfWeek(dk);
      if (dow === 0 || dow === 6) { weekendTotal += total; weekendDays++; }
      else { weekdayTotal += total; weekdayDays++; }
    }
    const avgWeekend = weekendDays > 0 ? weekendTotal / weekendDays : 0;
    const avgWeekday = weekdayDays > 0 ? weekdayTotal / weekdayDays : 0;
    if (avgWeekday > 0 && avgWeekend > avgWeekday * 1.5) {
      const ratio = Math.round((avgWeekend / avgWeekday) * 100 - 100);
      insights.push({
        type: "info",
        icon: "calendar",
        title: "Weekend spending pattern",
        description: `You spend ${ratio}% more on weekends (avg ${fmt(avgWeekend)}/day) vs weekdays (${fmt(avgWeekday)}/day).`,
        priority: 50,
      });
    }
  }

  // ── Top Spending Day ────────────────────────────────────────────────────
  if (last30.length >= 10) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const daySpend = [0, 0, 0, 0, 0, 0, 0];
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    for (const e of last30) {
      const dow = getDayOfWeek(e.dateKey);
      daySpend[dow] += Number(e.amount);
      dayCounts[dow]++;
    }
    const dayAverages = daySpend.map((s, i) => dayCounts[i] > 0 ? s / dayCounts[i] : 0);
    const maxIdx = dayAverages.indexOf(Math.max(...dayAverages));
    if (dayAverages[maxIdx] > 0) {
      insights.push({
        type: "info",
        icon: "calendar",
        title: `${dayNames[maxIdx]}s are your costliest`,
        description: `You average ${fmt(dayAverages[maxIdx])} in spending on ${dayNames[maxIdx]}s.`,
        priority: 35,
      });
    }
  }

  // ── No-Spend Days ───────────────────────────────────────────────────────
  const daysThisMonth = new Set();
  for (let d = 1; d <= dayOfMonth; d++) {
    const dk = `${month}-${String(d).padStart(2, "0")}`;
    daysThisMonth.add(dk);
  }
  const spendDays = new Set(monthDebits.map((e) => e.dateKey));
  const noSpendCount = [...daysThisMonth].filter((d) => !spendDays.has(d)).length;
  if (noSpendCount >= 3) {
    insights.push({
      type: "positive",
      icon: "streak",
      title: `${noSpendCount} no-spend days`,
      description: `You had ${noSpendCount} days this month with zero expenses. Each no-spend day strengthens your savings.`,
      priority: 45,
    });
  }

  // ── Budget Alerts ───────────────────────────────────────────────────────
  if (budgets && budgets.length > 0) {
    for (const budget of budgets) {
      const spent = currentCategoryTotals.get(budget.category) || 0;
      const percent = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0;
      const remaining = budget.amount - spent;
      const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - dayOfMonth;

      if (percent >= 100) {
        insights.push({
          type: "danger",
          icon: "alert",
          title: `${budget.category} budget exceeded`,
          description: `You've spent ${fmt(spent)} of your ${fmt(budget.amount)} budget (${percent}%). Over by ${fmt(spent - budget.amount)}.`,
          priority: 95,
        });
      } else if (percent >= 80) {
        const dailyRemaining = daysLeft > 0 ? remaining / daysLeft : 0;
        insights.push({
          type: "warning",
          icon: "alert",
          title: `${budget.category} budget almost used`,
          description: `${percent}% used. You have ${fmt(remaining)} left for ${daysLeft} days (${fmt(dailyRemaining)}/day).`,
          priority: 75,
        });
      }
    }
  }

  // ── Savings Rate Trend ──────────────────────────────────────────────────
  const monthIncome = credits
    .filter((e) => getMonthKey(e.dateKey) === month)
    .reduce((s, e) => s + Number(e.amount), 0);
  if (monthIncome > 0 && monthSpent > 0) {
    const rate = Math.round(((monthIncome - monthSpent) / monthIncome) * 100);
    if (rate < 10 && rate >= 0) {
      insights.push({
        type: "warning",
        icon: "trend-down",
        title: "Low savings rate",
        description: `Your savings rate is only ${rate}% this month. Consider cutting discretionary spending to save more.`,
        priority: 60,
      });
    } else if (rate >= 30) {
      insights.push({
        type: "positive",
        icon: "trend-up",
        title: "Strong savings rate",
        description: `You're saving ${rate}% of your income this month. Excellent financial health!`,
        priority: 30,
      });
    }
  }

  // ── Predicted Cash Flow ──────────────────────────────────────────────────
  const totalBalance = calculateTotalAvailableBalance(accounts, expenses);

  if (totalBalance > 0 && monthSpent > 0 && dayOfMonth >= 3) {
    const dailyRate = monthSpent / dayOfMonth;
    const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - dayOfMonth;
    const predictedEnd = totalBalance - (dailyRate * daysLeft);
    insights.push({
      type: predictedEnd < 0 ? "danger" : "info",
      icon: "forecast",
      title: "Month-end balance forecast",
      description: `At your current spending rate, your projected balance by month-end is ${fmt(predictedEnd)}.`,
      priority: predictedEnd < 0 ? 80 : 25,
    });
  }

  // Sort by priority (highest first), limit to top 5
  insights.sort((a, b) => b.priority - a.priority);
  return insights.slice(0, 5);
}

function fmt(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}
