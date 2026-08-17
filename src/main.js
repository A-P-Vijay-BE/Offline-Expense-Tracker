import "./style.css";
import { registerSW } from "virtual:pwa-register";
import {
  animateValue,
  initRippleEffect,
  initPageTransitions,
  initScrollHeader,
  initPullToRefresh,
  haptic,
  showSuccessAnimation,
  initSwipeNavigation,
} from "./ui-enhancements.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

import { appSettings } from "./firebase-config.js";
import { auth, firestore, isFirebaseConfigured } from "./firebase.js";
import {
  bulkPutExpenses,
  getAllAccounts,
  getAllExpenses,
  getAccount,
  getExpense,
  getPendingAccounts,
  getPendingExpenses,
  markAccountSynced,
  markAccountSyncError,
  markExpenseSynced,
  markExpenseSyncError,
  putAccount,
  putExpense,
  putBudget,
  getAllBudgets,
  deleteBudget,
  putRecurring,
  getAllRecurring,
  deleteRecurring,
  getActiveRecurring,
  getSetting,
  putSetting,
} from "./local-db.js";
import {
  calculateAccountBalance,
  calculateAllAccountBalances,
  calculateTotalAvailableBalance,
  calculateBalanceAfterEachTransaction,
  normalizeType,
} from "./balance-engine.js";
import { parseExpense } from "./parser.js";
import {
  isWebAuthnAvailable,
  isAppLockEnabled,
  enableAppLock,
  disableAppLock,
  verifyWithBiometrics,
} from "./app-lock.js";
// insights-engine.js is lazy-loaded where needed
import {
  logAudit as _logAudit,
  pruneOldAuditEntries,
  getAuditLog,
  getAuditLogCount,
  formatAuditEntry,
  relativeTime,
} from "./audit-log.js";

function logAudit(...args) {
  _logAudit(...args).catch((err) => console.warn("Audit log write failed:", err));
}
// chart-engine.js is lazy-loaded where needed
import { initErrorMonitor, reportError } from "./error-monitor.js";
import { initAnalytics, trackEvent, trackScreen } from "./analytics.js";

// ── Initialize Monitoring ───────────────────────────────────────────────────
initErrorMonitor();
initAnalytics();

// ── Global Error Handling ───────────────────────────────────────────────────
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  reportError(event.reason, "unhandledrejection");
  const msg = event.reason?.message || "An unexpected error occurred.";
  const toast = document.querySelector("#toast");
  if (toast) { toast.textContent = msg; toast.classList.remove("hidden"); setTimeout(() => toast.classList.add("hidden"), 3500); }
});

// ── PWA Registration ────────────────────────────────────────────────────────
registerSW({
  immediate: true,
  onOfflineReady() {
    showToast("The app is ready to work offline.");
  },
  onNeedRefresh() {
    showToast("A new version is available. Reopen the app to update.");
  },
});

// ── Constants ───────────────────────────────────────────────────────────────
const CATEGORIES = [
  "Food", "Groceries", "Bills", "Transport", "Shopping",
  "Health", "Salary", "Income", "Entertainment", "Education", "Other",
];

const CATEGORY_KEYWORDS = {
  Food: ["lunch", "dinner", "breakfast", "snack", "restaurant", "food", "tea", "coffee", "swiggy", "zomato", "hotel"],
  Groceries: ["grocery", "groceries", "vegetable", "vegetables", "milk", "supermarket"],
  Bills: ["electricity", "bill", "recharge", "internet", "wifi", "rent", "emi", "gas"],
  Transport: ["petrol", "diesel", "fuel", "bus", "train", "taxi", "uber", "ola", "auto", "parking", "toll"],
  Shopping: ["shopping", "dress", "shirt", "shoe", "amazon", "flipkart"],
  Health: ["medicine", "medical", "doctor", "hospital", "pharmacy", "health"],
  Salary: ["salary"],
  Income: ["income", "received", "credited", "bonus", "freelance"],
  Entertainment: ["movie", "cinema", "netflix", "prime", "game"],
  Education: ["course", "book", "school", "college", "training"],
};

function suggestCategory(description) {
  if (!description) return "Other";
  const lower = description.toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => lower.includes(w))) return cat;
  }
  return "Other";
}

// ── Debounce Utility ───────────────────────────────────────────────────────
function debounce(fn, ms = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ── DOM Elements ────────────────────────────────────────────────────────────
const el = {
  setupBanner: document.querySelector("#setupBanner"),
  authScreen: document.querySelector("#authScreen"),
  appScreen: document.querySelector("#appScreen"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  signInBtn: document.querySelector("#signInBtn"),
  createAccountBtn: document.querySelector("#createAccountBtn"),
  authMessage: document.querySelector("#authMessage"),
  logoutBtn: document.querySelector("#logoutBtn"),
  installBtn: document.querySelector("#installBtn"),
  networkBadge: document.querySelector("#networkBadge"),
  syncBadge: document.querySelector("#syncBadge"),
  lastSyncedTime: document.querySelector("#lastSyncedTime"),
  darkModeToggle: document.querySelector("#darkModeToggle"),
  settingsBtn: document.querySelector("#settingsBtn"),
  settingsPanel: document.querySelector("#settingsPanel"),
  // Tab navigation
  tabDashboard: document.querySelector("#tabDashboard"),
  tabAdd: document.querySelector("#tabAdd"),
  tabAccounts: document.querySelector("#tabAccounts"),
  tabHistory: document.querySelector("#tabHistory"),
  tabInsights: document.querySelector("#tabInsights"),
  panelDashboard: document.querySelector("#panelDashboard"),
  panelAdd: document.querySelector("#panelAdd"),
  panelAccounts: document.querySelector("#panelAccounts"),
  panelHistory: document.querySelector("#panelHistory"),
  panelInsights: document.querySelector("#panelInsights"),
  // Dashboard
  todayTotal: document.querySelector("#todayTotal"),
  monthTotal: document.querySelector("#monthTotal"),
  incomeTotal: document.querySelector("#incomeTotal"),
  totalAvailable: document.querySelector("#totalAvailable"),
  avgDailySpend: document.querySelector("#avgDailySpend"),
  savingsRate: document.querySelector("#savingsRate"),
  budgetList: document.querySelector("#budgetList"),
  recentTransactions: document.querySelector("#recentTransactions"),
  adjustmentsSummary: document.querySelector("#adjustmentsSummary"),
  adjustmentsSummaryContent: document.querySelector("#adjustmentsSummaryContent"),
  addBudgetBtn: document.querySelector("#addBudgetBtn"),
  // Add Transaction
  quickAddInput: document.querySelector("#quickAddInput"),
  transactionForm: document.querySelector("#transactionForm"),
  txTypeDebit: document.querySelector("#txTypeDebit"),
  txTypeCredit: document.querySelector("#txTypeCredit"),
  txTypeTransfer: document.querySelector("#txTypeTransfer"),
  txSingleAccountGroup: document.querySelector("#txSingleAccountGroup"),
  txTransferAccountGroup: document.querySelector("#txTransferAccountGroup"),
  txAccount: document.querySelector("#txAccount"),
  txFromAccount: document.querySelector("#txFromAccount"),
  txToAccount: document.querySelector("#txToAccount"),
  txAmount: document.querySelector("#txAmount"),
  txDescription: document.querySelector("#txDescription"),
  txCategory: document.querySelector("#txCategory"),
  txCategoryGroup: document.querySelector("#txCategoryGroup"),
  txDate: document.querySelector("#txDate"),
  txRepeat: document.querySelector("#txRepeat"),
  composerMessage: document.querySelector("#composerMessage"),
  // Accounts
  accountsList: document.querySelector("#accountsList"),
  addAccountBtn: document.querySelector("#addAccountBtn"),
  // History
  searchInput: document.querySelector("#searchInput"),
  typeFilter: document.querySelector("#typeFilter"),
  accountFilter: document.querySelector("#accountFilter"),
  dateRangeStart: document.querySelector("#dateRangeStart"),
  dateRangeEnd: document.querySelector("#dateRangeEnd"),
  amountMin: document.querySelector("#amountMin"),
  amountMax: document.querySelector("#amountMax"),
  historyList: document.querySelector("#historyList"),
  filterSheetBtn: document.querySelector("#filterSheetBtn"),
  filterSheet: document.querySelector("#filterSheet"),
  // Insights
  categoryChart: document.querySelector("#categoryChart"),
  trendChart: document.querySelector("#trendChart"),
  incomeExpenseChart: document.querySelector("#incomeExpenseChart"),
  spendingHeatmap: document.querySelector("#spendingHeatmap"),
  insightsKpiStrip: document.querySelector("#insightsKpiStrip"),
  // FAB
  fabBtn: document.querySelector("#fabBtn"),
  // Onboarding
  onboardingOverlay: document.querySelector("#onboardingOverlay"),
  // Confirm modal
  confirmModal: document.querySelector("#confirmModal"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmMessage: document.querySelector("#confirmMessage"),
  confirmYes: document.querySelector("#confirmYes"),
  confirmNo: document.querySelector("#confirmNo"),
  // Toast
  toast: document.querySelector("#toast"),
  // Account modal
  accountModal: document.querySelector("#accountModal"),
  accountModalTitle: document.querySelector("#accountModalTitle"),
  accountNameInput: document.querySelector("#accountNameInput"),
  accountTypeInput: document.querySelector("#accountTypeInput"),
  accountOpeningBalance: document.querySelector("#accountOpeningBalance"),
  accountOpeningDate: document.querySelector("#accountOpeningDate"),
  accountAlias: document.querySelector("#accountAlias"),
  accountArchivedField: document.querySelector("#accountArchivedField"),
  accountArchivedCheck: document.querySelector("#accountArchivedCheck"),
  accountModalMessage: document.querySelector("#accountModalMessage"),
  saveAccountBtn: document.querySelector("#saveAccountBtn"),
  editOpeningBalanceBtn: document.querySelector("#editOpeningBalanceBtn"),
  // Edit balance modal
  editBalanceModal: document.querySelector("#editBalanceModal"),
  editBalanceAccountName: document.querySelector("#editBalanceAccountName"),
  editBalanceCurrentAmt: document.querySelector("#editBalanceCurrentAmt"),
  editBalanceActual: document.querySelector("#editBalanceActual"),
  editBalanceReason: document.querySelector("#editBalanceReason"),
  editBalanceDate: document.querySelector("#editBalanceDate"),
  editBalanceMessage: document.querySelector("#editBalanceMessage"),
  saveBalanceBtn: document.querySelector("#saveBalanceBtn"),
  // Edit opening balance modal
  editOpeningBalanceModal: document.querySelector("#editOpeningBalanceModal"),
  editOpeningAccountName: document.querySelector("#editOpeningAccountName"),
  editOpeningCurrentAmt: document.querySelector("#editOpeningCurrentAmt"),
  editOpeningWarning: document.querySelector("#editOpeningWarning"),
  editOpeningNewBalance: document.querySelector("#editOpeningNewBalance"),
  editOpeningMessage: document.querySelector("#editOpeningMessage"),
  saveOpeningBalanceBtn: document.querySelector("#saveOpeningBalanceBtn"),
  createAdjustmentInsteadBtn: document.querySelector("#createAdjustmentInsteadBtn"),
  // Account activity modal
  accountActivityModal: document.querySelector("#accountActivityModal"),
  accountActivityTitle: document.querySelector("#accountActivityTitle"),
  accountActivityBalance: document.querySelector("#accountActivityBalance"),
  accountActivityList: document.querySelector("#accountActivityList"),
  activityEditDetailsBtn: document.querySelector("#activityEditDetailsBtn"),
  activityEditBalanceBtn: document.querySelector("#activityEditBalanceBtn"),
  // Budget modal
  budgetModal: document.querySelector("#budgetModal"),
  budgetCategory: document.querySelector("#budgetCategory"),
  budgetAmount: document.querySelector("#budgetAmount"),
  budgetModalMessage: document.querySelector("#budgetModalMessage"),
  saveBudgetBtn: document.querySelector("#saveBudgetBtn"),
  // Export/backup
  exportCsvBtn: document.querySelector("#exportCsvBtn"),
  exportJsonBtn: document.querySelector("#exportJsonBtn"),
  importJsonInput: document.querySelector("#importJsonInput"),
  syncNowBtn: document.querySelector("#syncNowBtn"),
};

// ── State ───────────────────────────────────────────────────────────────────
let currentUser = null;
let cloudUnsubscribe = null;
let isSyncing = false;
let installPrompt = null;
let cachedExpenses = [];
let cachedAccounts = [];
let cachedBudgets = [];
let cachedRecurring = [];
let editingAccountId = null;
let editingAdjustmentId = null;
let adjustmentTargetAccountId = null;
let activityViewAccountId = null;
let lastSelectedAccountId = null;
let confirmResolve = null;
let undoTimeout = null;
let undoTransactions = [];
let historyPageSize = 30;
let historyDisplayCount = 30;

// ── Utility Functions ───────────────────────────────────────────────────────
function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthKey() {
  return localDateKey().slice(0, 7);
}

function formatMoney(amount) {
  return new Intl.NumberFormat(appSettings.locale, {
    style: "currency",
    currency: appSettings.currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function formatDate(dateKey) {
  if (!dateKey) return "";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(appSettings.locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatDateGroup(dateKey) {
  const today = localDateKey();
  if (dateKey === today) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === localDateKey(yesterday)) return "Yesterday";
  return formatDate(dateKey);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showMessage(element, text, isError = false) {
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function setFieldError(fieldEl, errorEl, message) {
  if (errorEl) errorEl.textContent = message;
  if (fieldEl) fieldEl.classList.add(fieldEl.classList.contains("tx-amount-group") ? "tx-amount-group--error" : fieldEl.classList.contains("form-field") ? "form-field--error" : "tx-field--error");
}

function clearFieldError(fieldEl, errorEl) {
  if (errorEl) errorEl.textContent = "";
  if (fieldEl) fieldEl.classList.remove("tx-field--error", "form-field--error", "tx-amount-group--error");
}

function showToast(text) {
  if (undoTimeout) { clearTimeout(undoTimeout); undoTransactions = []; }
  el.toast.className = "toast";
  el.toast.textContent = text;
  el.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    el.toast.classList.add("hidden");
  }, 2600);
}

// ── Custom Confirm Modal ────────────────────────────────────────────────────
function showConfirm(title, message) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
    el.confirmNo.focus();
  });
}

function handleConfirmYes() {
  el.confirmModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (confirmResolve) confirmResolve(true);
  confirmResolve = null;
}

function handleConfirmNo() {
  el.confirmModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (confirmResolve) confirmResolve(false);
  confirmResolve = null;
}

// ── Dark Mode ───────────────────────────────────────────────────────────────
async function initDarkMode() {
  const saved = await getSetting("darkMode");
  if (saved === "dark") {
    applyTheme("dark");
  } else if (saved === "light") {
    applyTheme("light");
  } else {
    const prefer = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefer ? "dark" : "light");
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const sunIcon = document.querySelector(".icon-sun");
  const moonIcon = document.querySelector(".icon-moon");
  if (sunIcon) sunIcon.style.display = theme === "dark" ? "none" : "";
  if (moonIcon) moonIcon.style.display = theme === "dark" ? "" : "none";
  const settingToggle = document.querySelector("#darkModeSettingToggle");
  if (settingToggle) settingToggle.checked = theme === "dark";
}

function toggleDarkMode() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  putSetting("darkMode", next);
}

// ── Display Name ────────────────────────────────────────────────────────────
let userName = "";

async function loadUserName() {
  userName = (await getSetting("userName")) || "";
  applyUserName();
}

function applyUserName() {
  const topbarGreeting = document.querySelector("#topbarGreeting");
  const topbarUsername = document.querySelector("#topbarUsername");
  const dashboardHello = document.querySelector("#dashboardHello");
  const dashboardAvatar = document.querySelector("#dashboardAvatar");
  const dashboardDate = document.querySelector("#dashboardDate");
  const nameInput = document.querySelector("#displayNameInput");

  const greeting = getTimeGreeting();

  if (userName) {
    if (topbarGreeting) topbarGreeting.textContent = greeting;
    if (topbarUsername) topbarUsername.textContent = userName;
    if (dashboardHello) dashboardHello.textContent = `${greeting}, ${userName}!`;
    if (dashboardAvatar) dashboardAvatar.textContent = userName.charAt(0).toUpperCase();
  } else {
    if (topbarGreeting) topbarGreeting.textContent = "My Expenses";
    if (topbarUsername) topbarUsername.textContent = "";
    if (dashboardHello) dashboardHello.textContent = `${greeting}!`;
    if (dashboardAvatar) dashboardAvatar.textContent = "U";
  }

  if (dashboardDate) {
    const dateStr = new Date().toLocaleDateString(appSettings.locale, {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    const todayTxCount = cachedExpenses.filter((e) => !e.deleted && e.dateKey === localDateKey()).length;
    const contextHint = todayTxCount > 0 ? ` • ${todayTxCount} transaction${todayTxCount > 1 ? "s" : ""} today` : "";
    dashboardDate.textContent = dateStr + contextHint;
  }

  if (nameInput && !nameInput.dataset.touched) {
    nameInput.value = userName;
  }
}

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

async function saveUserName(name) {
  userName = name.trim();
  await putSetting("userName", userName);
  applyUserName();
  showToast(userName ? `Welcome, ${userName}!` : "Name cleared.");
}

// ── Tab Navigation ──────────────────────────────────────────────────────────
const tabs = [
  { btn: el.tabDashboard, panel: el.panelDashboard, key: "dashboard" },
  { btn: el.tabAdd, panel: el.panelAdd, key: "add" },
  { btn: el.tabAccounts, panel: el.panelAccounts, key: "accounts" },
  { btn: el.tabHistory, panel: el.panelHistory, key: "history" },
  { btn: el.tabInsights, panel: el.panelInsights, key: "insights" },
];

function switchTab(key) {
  for (const tab of tabs) {
    const isActive = tab.key === key;
    tab.btn.classList.toggle("tab-nav__btn--active", isActive);
    tab.btn.setAttribute("aria-selected", String(isActive));
    tab.panel.classList.toggle("tab-panel--active", isActive);
    tab.panel.hidden = !isActive;
  }
  putSetting("lastTab", key);
  trackScreen(key);
}

async function restoreLastTab() {
  const last = await getSetting("lastTab");
  if (last && tabs.some((t) => t.key === last)) {
    switchTab(last);
  }
}

// ── Network & Sync Badges ───────────────────────────────────────────────────
function setNetworkBadge() {
  const online = navigator.onLine;
  el.networkBadge.textContent = online ? "Online" : "Offline";
  el.networkBadge.classList.toggle("offline", !online);
}

function updateLastSynced() {
  const now = new Date();
  const time = now.toLocaleTimeString(appSettings.locale, { hour: "2-digit", minute: "2-digit" });
  el.lastSyncedTime.textContent = `Synced ${time}`;
}

// ── Balance Helpers ─────────────────────────────────────────────────────────
const balanceCache = new Map();

function getAccountBalance(accountId) {
  if (balanceCache.has(accountId)) return balanceCache.get(accountId);
  const account = cachedAccounts.find((a) => a.id === accountId);
  const balance = calculateAccountBalance(account, cachedExpenses);
  balanceCache.set(accountId, balance);
  return balance;
}

function getTotalBalance() {
  return calculateTotalAvailableBalance(cachedAccounts, cachedExpenses);
}

let cachedVisibleExpenses = [];

function getVisibleExpenses() {
  return cachedVisibleExpenses;
}

function recomputeVisibleExpenses() {
  cachedVisibleExpenses = cachedExpenses
    .filter((expense) => !expense.deleted)
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
}

// ── Insights Sub-tab Navigation ─────────────────────────────────────────────
let activeInsightsTab = "analysis";

function initInsightsSubtabs() {
  const subtabs = document.querySelectorAll(".insights-subtab");
  const panels = document.querySelectorAll(".insights-tab-content");

  subtabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.insightsTab;
      if (key === activeInsightsTab) return;
      activeInsightsTab = key;

      subtabs.forEach((t) => {
        t.classList.toggle("active", t.dataset.insightsTab === key);
        t.setAttribute("aria-selected", String(t.dataset.insightsTab === key));
      });
      panels.forEach((p) => {
        p.classList.toggle("active", p.dataset.insightsPanel === key);
      });

      renderInsightsForTab(key);
    });
  });
}

function renderInsightsForTab(tab) {
  switch (tab) {
    case "overview":
      renderCategories();
      renderInsights();
      break;
    case "daily":
      renderDailySummary();
      break;
    case "trends":
      renderTrendChart();
      renderIncomeExpenseChart();
      break;
    case "analysis":
      renderSpendingHeatmap();
      renderSpendingAnalysis();
      break;
  }
}

// ── Insights KPI Strip ──────────────────────────────────────────────────────
function renderInsightsKpi() {
  const visible = getVisibleExpenses();
  const month = currentMonthKey();

  const monthExpense = visible
    .filter((item) => normalizeType(item.type) === "debit" && String(item.dateKey).startsWith(month))
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const monthIncome = visible
    .filter((item) => normalizeType(item.type) === "credit" && String(item.dateKey).startsWith(month))
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const dayOfMonth = new Date().getDate();
  const avgDaily = dayOfMonth > 0 ? monthExpense / dayOfMonth : 0;

  const prevMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const prevExpense = visible
    .filter((item) => normalizeType(item.type) === "debit" && String(item.dateKey).startsWith(prevMonthKey))
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const change = prevExpense > 0 ? Math.round(((monthExpense - prevExpense) / prevExpense) * 100) : 0;
  const changeLabel = change > 0 ? `+${change}%` : `${change}%`;
  const changeClass = change > 0 ? "insights-kpi-strip__value--danger" : change < 0 ? "insights-kpi-strip__value--success" : "";

  const kpiSpent = document.querySelector("#kpiMonthSpent");
  const kpiIncome = document.querySelector("#kpiMonthIncome");
  const kpiAvg = document.querySelector("#kpiAvgDaily");
  const kpiMom = document.querySelector("#kpiMomChange");

  if (kpiSpent) kpiSpent.textContent = formatMoney(monthExpense);
  if (kpiIncome) kpiIncome.textContent = formatMoney(monthIncome);
  if (kpiAvg) kpiAvg.textContent = formatMoney(avgDaily);
  if (kpiMom) {
    kpiMom.textContent = changeLabel;
    kpiMom.className = `insights-kpi-strip__value ${changeClass}`;
  }
}

// ── Main Refresh ────────────────────────────────────────────────────────────
async function refreshUI() {
  [cachedExpenses, cachedAccounts, cachedBudgets, cachedRecurring] = await Promise.all([
    getAllExpenses(),
    getAllAccounts(),
    getAllBudgets(),
    getAllRecurring(),
  ]);
  balanceCache.clear();
  recomputeVisibleExpenses();
  renderSummary();
  renderBudgets();
  renderRecurring();
  renderRecentTransactions();
  renderInsightsKpi();
  renderInsightsForTab(activeInsightsTab);
  renderHistory();
  renderSyncState();
  renderAccounts();
  renderAdjustmentsSummary();
  populateAccountDropdowns();
  applyUserName();
}

// ── Summary Cards ───────────────────────────────────────────────────────────
function renderSummary() {
  const visible = getVisibleExpenses();
  const today = localDateKey();
  const month = currentMonthKey();

  const todayExpense = visible
    .filter((item) => normalizeType(item.type) === "debit" && item.dateKey === today)
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const monthExpense = visible
    .filter((item) => normalizeType(item.type) === "debit" && String(item.dateKey).startsWith(month))
    .reduce((sum, item) => sum + Number(item.amount), 0);

  const monthIncome = visible
    .filter((item) => normalizeType(item.type) === "credit" && String(item.dateKey).startsWith(month))
    .reduce((sum, item) => sum + Number(item.amount), 0);

  // Average daily spend
  const dayOfMonth = new Date().getDate();
  const avgDaily = dayOfMonth > 0 ? monthExpense / dayOfMonth : 0;

  // Savings rate
  const savings = monthIncome > 0 ? Math.round(((monthIncome - monthExpense) / monthIncome) * 100) : 0;

  el.todayTotal._formatter = formatMoney;
  el.monthTotal._formatter = formatMoney;
  el.incomeTotal._formatter = formatMoney;

  const prevToday = Number(el.todayTotal._lastVal) || 0;
  const prevMonth = Number(el.monthTotal._lastVal) || 0;
  const prevIncome = Number(el.incomeTotal._lastVal) || 0;

  animateValue(el.todayTotal, prevToday, todayExpense);
  animateValue(el.monthTotal, prevMonth, monthExpense);
  animateValue(el.incomeTotal, prevIncome, monthIncome);

  el.todayTotal._lastVal = todayExpense;
  el.monthTotal._lastVal = monthExpense;
  el.incomeTotal._lastVal = monthIncome;

  if (el.totalAvailable) el.totalAvailable.textContent = formatMoney(getTotalBalance());
  if (el.avgDailySpend) el.avgDailySpend.textContent = formatMoney(avgDaily);
  if (el.savingsRate) el.savingsRate.textContent = `${savings}%`;
}

// ── Budget Rendering ────────────────────────────────────────────────────────
function renderBudgets() {
  if (!el.budgetList) return;
  if (!cachedBudgets.length) {
    el.budgetList.innerHTML = '<p class="budget-list__empty">No budgets set. Tap "+ Set Budget" to add one.</p>';
    renderBudgetAlert([]);
    return;
  }

  const month = currentMonthKey();
  const visible = getVisibleExpenses();
  const budgetData = [];

  el.budgetList.innerHTML = cachedBudgets.map((budget) => {
    const spent = visible
      .filter((item) => normalizeType(item.type) === "debit" && item.category === budget.category && String(item.dateKey).startsWith(month))
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const percent = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0;
    const statusClass = percent > 100 ? "budget-over" : percent >= 75 ? "budget-warning" : "";
    const barWidth = Math.min(percent, 100);
    budgetData.push({ category: budget.category, spent, limit: budget.amount, percent });
    return `
      <div class="budget-item ${statusClass}" data-budget-id="${escapeHtml(budget.id)}">
        <div class="budget-item__header">
          <span class="budget-item__category">${escapeHtml(budget.category)}</span>
          <span class="budget-item__amounts">${escapeHtml(formatMoney(spent))} / ${escapeHtml(formatMoney(budget.amount))}</span>
        </div>
        <div class="budget-bar">
          <div class="budget-fill ${statusClass}" style="width:${barWidth}%"></div>
        </div>
        <div class="budget-item__footer">
          <span class="budget-item__percent">${percent}%</span>
          <button class="small-btn danger" data-action="delete-budget" data-budget-id="${escapeHtml(budget.id)}">Remove</button>
        </div>
      </div>
    `;
  }).join("");

  renderBudgetAlert(budgetData);
}

function renderBudgetAlert(budgetData) {
  const alertCard = document.querySelector("#budgetAlertCard");
  if (!alertCard) return;

  const warnings = budgetData.filter((b) => b.percent >= 75).sort((a, b) => b.percent - a.percent);
  if (!warnings.length) { alertCard.classList.add("hidden"); return; }

  const top = warnings[0];
  const remaining = top.limit - top.spent;
  const fillClass = top.percent >= 100 ? "budget-alert-card__fill--danger" : "";

  alertCard.classList.remove("hidden");
  alertCard.innerHTML = `
    <span class="budget-alert-card__icon">${top.percent >= 100 ? "🚨" : "⚠️"}</span>
    <div class="budget-alert-card__text">
      ${escapeHtml(top.category)}: ${escapeHtml(formatMoney(top.spent))} / ${escapeHtml(formatMoney(top.limit))} (${top.percent}%)
      ${remaining > 0 ? ` — ${escapeHtml(formatMoney(remaining))} left this month` : " — Over budget!"}
      <div class="budget-alert-card__progress">
        <div class="budget-alert-card__fill ${fillClass}" style="width:${Math.min(top.percent, 100)}%"></div>
      </div>
    </div>
  `;
}

// ── Recurring Transactions (Dashboard) ─────────────────────────────────────
function renderRecurring() {
  const list = document.querySelector("#recurringList");
  if (!list) return;

  const active = cachedRecurring.filter((r) => !r.paused && !r.deleted);
  const paused = cachedRecurring.filter((r) => r.paused && !r.deleted);

  if (!active.length && !paused.length) {
    list.innerHTML = '<p class="empty-state">No recurring transactions. Use "Repeat" option when adding a transaction.</p>';
    return;
  }

  let html = "";
  for (const item of [...active, ...paused]) {
    const isPaused = item.paused;
    const freqLabel = item.frequency.charAt(0).toUpperCase() + item.frequency.slice(1);
    const nextDate = item.nextOccurrence || "—";
    html += `
      <div class="recurring-item ${isPaused ? "recurring-item--paused" : ""}" data-recurring-id="${escapeHtml(item.id)}">
        <div class="recurring-item__info">
          <strong class="recurring-item__desc">${escapeHtml(item.description || item.category)}</strong>
          <span class="recurring-item__meta">${escapeHtml(formatMoney(item.amount))} • ${escapeHtml(freqLabel)} • Next: ${escapeHtml(nextDate)}</span>
        </div>
        <div class="recurring-item__actions">
          <button type="button" class="small-btn" data-action="${isPaused ? "resume" : "pause"}-recurring">${isPaused ? "Resume" : "Pause"}</button>
          <button type="button" class="small-btn danger" data-action="delete-recurring">Delete</button>
        </div>
      </div>
    `;
  }
  list.innerHTML = html;
}

// ── Recent Transactions (Dashboard) ─────────────────────────────────────────
function renderRecentTransactions() {
  if (!el.recentTransactions) return;
  const recent = getVisibleExpenses().slice(0, 5);
  if (!recent.length) {
    el.recentTransactions.innerHTML = '<p class="empty-state">No transactions yet.</p>';
    return;
  }
  el.recentTransactions.innerHTML = recent.map((item) => renderTransactionItem(item)).join("");
}

// ── Category Chart (Donut + collapsible details) ────────────────────────────
async function renderCategories() {
  if (!el.categoryChart) return;
  const { renderDonutChart } = await import("./chart-engine.js");
  const month = currentMonthKey();
  const categoryTotals = new Map();

  for (const item of getVisibleExpenses()) {
    const t = normalizeType(item.type);
    if (t !== "debit" || !String(item.dateKey).startsWith(month)) continue;
    const current = categoryTotals.get(item.category) || 0;
    categoryTotals.set(item.category, current + Number(item.amount));
  }

  const sorted = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);

  if (!sorted.length) {
    el.categoryChart.innerHTML = '<p class="empty-state">No expense data for this month.</p>';
    return;
  }

  const categories = sorted.map(([name, amount]) => ({ name, amount }));
  const donut = renderDonutChart(categories, formatMoney);

  const maximum = sorted[0][1];
  const bars = sorted.map(([category, amount]) => {
    const width = Math.max(5, Math.round((amount / maximum) * 100));
    return `
      <div class="category-row">
        <div class="category-meta">
          <span>${escapeHtml(category)}</span>
          <strong>${escapeHtml(formatMoney(amount))}</strong>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%"></div>
        </div>
      </div>
    `;
  }).join("");

  el.categoryChart.innerHTML = donut + `
    <details class="category-details">
      <summary class="category-details__toggle">Show breakdown details</summary>
      <div class="category-bars">${bars}</div>
    </details>
  `;
}

// ── Monthly Trend Chart (Line + Summary) ────────────────────────────────────
async function renderTrendChart() {
  if (!el.trendChart) return;
  const { renderLineChart } = await import("./chart-engine.js");
  const visible = getVisibleExpenses();
  const monthlyTotals = new Map();

  for (const item of visible) {
    const t = normalizeType(item.type);
    if (t !== "debit") continue;
    const mk = String(item.dateKey).slice(0, 7);
    monthlyTotals.set(mk, (monthlyTotals.get(mk) || 0) + Number(item.amount));
  }

  const sorted = [...monthlyTotals.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6);

  if (sorted.length < 2) {
    el.trendChart.innerHTML = '<p class="trend-chart__placeholder">Need at least 2 months of data to show trends.</p>';
    return;
  }

  const dataPoints = sorted.map(([monthKey, amount]) => ({
    label: new Date(monthKey + "-01").toLocaleDateString(appSettings.locale, { month: "short" }),
    value: amount,
  }));

  const lineChart = renderLineChart(dataPoints, formatMoney);

  const curr = sorted[sorted.length - 1][1];
  const prev = sorted[sorted.length - 2][1];
  const change = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0;
  const changeLabel = change > 0 ? `+${change}%` : `${change}%`;
  const changeClass = change > 0 ? "trend-up" : change < 0 ? "trend-down" : "";

  el.trendChart.innerHTML = `
    ${lineChart}
    <div class="trend-chart__footer">
      <span>This month: <strong>${escapeHtml(formatMoney(curr))}</strong></span>
      <span class="trend-chart__change ${changeClass}">${escapeHtml(changeLabel)} vs last month</span>
    </div>
  `;
}

// ── Daily Summary (Day-wise Debit/Credit Totals) ────────────────────────────
let dailySummaryMonth = null;
let dailySummaryShowBalance = false;

function renderDailySummary() {
  const container = document.querySelector("#dailySummary");
  if (!container) return;

  if (!dailySummaryMonth) dailySummaryMonth = currentMonthKey();
  const month = dailySummaryMonth;
  const today = localDateKey();
  const visible = getVisibleExpenses();

  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const dailyMap = new Map();
  const dailyTransactions = new Map();
  let monthTotalDebit = 0;
  let monthTotalCredit = 0;
  const accountNetMap = new Map();

  for (const item of visible) {
    const dk = String(item.dateKey);
    if (!dk.startsWith(month)) continue;
    const t = normalizeType(item.type);
    if (t !== "debit" && t !== "credit") continue;
    const amt = Number(item.amount);
    if (!dailyMap.has(dk)) dailyMap.set(dk, { debit: 0, credit: 0 });
    const entry = dailyMap.get(dk);
    if (t === "debit") { entry.debit += amt; monthTotalDebit += amt; }
    else { entry.credit += amt; monthTotalCredit += amt; }
    if (!dailyTransactions.has(dk)) dailyTransactions.set(dk, []);
    dailyTransactions.get(dk).push(item);

    const accId = item.accountId;
    if (accId) {
      if (!accountNetMap.has(accId)) accountNetMap.set(accId, { debit: 0, credit: 0 });
      const accEntry = accountNetMap.get(accId);
      if (t === "debit") accEntry.debit += amt;
      else accEntry.credit += amt;
    }
  }

  const allDays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dk = `${month}-${String(d).padStart(2, "0")}`;
    const data = dailyMap.get(dk) || { debit: 0, credit: 0 };
    allDays.push({ dk, ...data });
  }

  const maxDebit = Math.max(...allDays.map((d) => d.debit), 1);
  const isCurrentMonth = month === currentMonthKey();
  const monthDate = new Date(month + "-01");
  const monthLabel = monthDate.toLocaleDateString(appSettings.locale, { month: "long", year: "numeric" });

  const prevMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1);
  const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
  const canGoNext = !isCurrentMonth;
  const prevKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
  const nextKey = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`;

  const grandTotal = monthTotalDebit + monthTotalCredit || 1;
  const debitPct = Math.round((monthTotalDebit / grandTotal) * 100);
  const creditPct = 100 - debitPct;
  const monthNet = monthTotalCredit - monthTotalDebit;
  const netClass = monthNet >= 0 ? "positive" : "negative";

  let html = `<div class="daily-summary__visual-totals">`;
  html += `<div class="daily-summary__visual-card daily-summary__visual-card--debit"><span class="daily-summary__visual-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></span><span class="daily-summary__visual-label">Total Debit</span><strong class="daily-summary__visual-amount">${formatMoney(monthTotalDebit)}</strong></div>`;
  html += `<div class="daily-summary__visual-card daily-summary__visual-card--credit"><span class="daily-summary__visual-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></span><span class="daily-summary__visual-label">Total Credit</span><strong class="daily-summary__visual-amount">${formatMoney(monthTotalCredit)}</strong></div>`;
  html += `</div>`;
  html += `<div class="daily-summary__ratio-bar"><div class="daily-summary__ratio-debit" style="width:${debitPct}%"><span>${debitPct}%</span></div><div class="daily-summary__ratio-credit" style="width:${creditPct}%"><span>${creditPct}%</span></div></div>`;
  html += `<div class="daily-summary__net-flow"><span>Net Flow:</span><strong class="${netClass}">${monthNet >= 0 ? "+" : ""}${formatMoney(Math.abs(monthNet))}</strong></div>`;

  if (accountNetMap.size > 1) {
    html += `<div class="daily-summary__account-nets">`;
    for (const [accId, data] of accountNetMap) {
      const accName = getAccountName(accId) || "Unknown";
      const accNet = data.credit - data.debit;
      const accNetClass = accNet >= 0 ? "positive" : "negative";
      html += `<div class="daily-summary__account-net-item">`;
      html += `<span class="daily-summary__account-net-name">${escapeHtml(accName)}</span>`;
      html += `<span class="daily-summary__account-net-value ${accNetClass}">${accNet >= 0 ? "+" : ""}${formatMoney(Math.abs(accNet))}</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  html += `<div class="daily-summary__header">`;
  html += `<button class="daily-summary__nav-btn" data-ds-nav="${prevKey}" aria-label="Previous month"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>`;
  html += `<span class="daily-summary__month">${escapeHtml(monthLabel)}</span>`;
  html += `<button class="daily-summary__nav-btn${canGoNext ? "" : " daily-summary__nav-btn--disabled"}" data-ds-nav="${nextKey}" ${canGoNext ? "" : "disabled"} aria-label="Next month"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`;
  html += `<button class="daily-summary__toggle-bal${dailySummaryShowBalance ? " active" : ""}" data-ds-toggle-bal aria-label="${dailySummaryShowBalance ? "Hide running balance" : "Show running balance"}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg><span class="daily-summary__toggle-label">${dailySummaryShowBalance ? "Balance" : "Balance"}</span></button>`;
  html += `</div>`;

  html += '<div class="daily-summary__scroll">';
  html += '<div class="daily-summary__table">';
  html += `<div class="daily-summary__row daily-summary__row--head"><span class="daily-summary__cell daily-summary__cell--date">Date</span><span class="daily-summary__cell daily-summary__cell--spark"></span><span class="daily-summary__cell daily-summary__cell--debit">Debit</span><span class="daily-summary__cell daily-summary__cell--credit">Credit</span><span class="daily-summary__cell daily-summary__cell--net">Net</span>${dailySummaryShowBalance ? '<span class="daily-summary__cell daily-summary__cell--bal">Balance</span>' : ""}</div>`;

  let totalDebit = 0;
  let totalCredit = 0;
  let runningBalance = 0;

  const sortedDays = [...allDays].reverse();
  const weekRows = [];
  let currentWeek = null;
  let weekDebit = 0;
  let weekCredit = 0;

  const runningBalances = new Map();
  let cumBal = 0;
  for (const day of allDays) {
    cumBal += day.credit - day.debit;
    runningBalances.set(day.dk, cumBal);
  }

  for (const day of sortedDays) {
    const { dk, debit, credit } = day;
    const dayDate = new Date(dk + "T00:00:00");
    const weekNum = getISOWeek(dayDate);
    const isFutureDay = isCurrentMonth && dk > today;

    if (isFutureDay) continue;

    if (currentWeek !== null && currentWeek !== weekNum) {
      html += renderWeekSeparator(weekCredit, weekDebit, currentWeek);
      weekDebit = 0;
      weekCredit = 0;
    }
    currentWeek = weekNum;

    totalDebit += debit;
    totalCredit += credit;
    weekDebit += debit;
    weekCredit += credit;

    const net = credit - debit;
    const isToday = dk === today;
    const isNoSpend = debit === 0 && credit === 0;
    const heatPct = debit / maxDebit;
    const dayLabel = dayDate.toLocaleDateString(appSettings.locale, { weekday: "short", day: "numeric" });
    const netClass = net >= 0 ? "positive" : "negative";
    const sparkWidth = Math.round((debit / maxDebit) * 100);
    const bal = runningBalances.get(dk) || 0;

    let rowClass = "daily-summary__row";
    if (isToday) rowClass += " daily-summary__row--today";
    if (isNoSpend) rowClass += " daily-summary__row--no-spend";

    const heatBg = debit > 0 ? `rgba(var(--heat-rgb), ${(heatPct * 0.1).toFixed(3)})` : "transparent";
    const hasTransactions = dailyTransactions.has(dk) && dailyTransactions.get(dk).length > 0;

    html += `<div class="${rowClass}" style="background:${heatBg}" ${hasTransactions ? `data-ds-expand="${dk}"` : ""}>`;
    html += `<span class="daily-summary__cell daily-summary__cell--date">${isNoSpend ? '<span class="daily-summary__no-spend-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : ""}${escapeHtml(dayLabel)}${isToday ? '<span class="daily-summary__today-badge">Today</span>' : ""}</span>`;
    html += `<span class="daily-summary__cell daily-summary__cell--spark"><span class="daily-summary__spark-bar" style="width:${sparkWidth}%"></span></span>`;
    html += `<span class="daily-summary__cell daily-summary__cell--debit">${debit > 0 ? formatMoney(debit) : "—"}</span>`;
    html += `<span class="daily-summary__cell daily-summary__cell--credit">${credit > 0 ? formatMoney(credit) : "—"}</span>`;
    html += `<span class="daily-summary__cell daily-summary__cell--net ${netClass}">${isNoSpend ? "—" : (net >= 0 ? "+" : "") + formatMoney(Math.abs(net))}</span>`;
    if (dailySummaryShowBalance) {
      const balClass = bal >= 0 ? "positive" : "negative";
      html += `<span class="daily-summary__cell daily-summary__cell--bal ${balClass}">${bal >= 0 ? "+" : ""}${formatMoney(Math.abs(bal))}</span>`;
    }
    html += `${hasTransactions ? '<span class="daily-summary__expand-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>' : ""}</div>`;

    if (hasTransactions) {
      html += `<div class="daily-summary__detail" id="ds-detail-${dk}" hidden>`;
      for (const txn of dailyTransactions.get(dk)) {
        const txnType = normalizeType(txn.type);
        const txnClass = txnType === "credit" ? "positive" : "negative";
        html += `<div class="daily-summary__txn">`;
        html += `<span class="daily-summary__txn-desc">${escapeHtml(txn.category || txn.description || "Transaction")}</span>`;
        html += `<span class="daily-summary__txn-amt ${txnClass}">${txnType === "credit" ? "+" : "-"}${formatMoney(txn.amount)}</span>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
  }

  if (currentWeek !== null) {
    html += renderWeekSeparator(weekCredit, weekDebit, currentWeek);
  }

  html += "</div>"; // closes .daily-summary__table

  const totalNet = totalCredit - totalDebit;
  const totalNetClass = totalNet >= 0 ? "positive" : "negative";
  html += `<div class="daily-summary__footer">`;
  html += `<div class="daily-summary__row daily-summary__row--total">`;
  html += `<span class="daily-summary__cell daily-summary__cell--date">Total</span>`;
  html += `<span class="daily-summary__cell daily-summary__cell--spark"></span>`;
  html += `<span class="daily-summary__cell daily-summary__cell--debit">${formatMoney(totalDebit)}</span>`;
  html += `<span class="daily-summary__cell daily-summary__cell--credit">${formatMoney(totalCredit)}</span>`;
  html += `<span class="daily-summary__cell daily-summary__cell--net ${totalNetClass}">${totalNet >= 0 ? "+" : ""}${formatMoney(Math.abs(totalNet))}</span>`;
  if (dailySummaryShowBalance) {
    html += `<span class="daily-summary__cell daily-summary__cell--bal"></span>`;
  }
  html += "</div>";
  html += "</div>"; // closes .daily-summary__footer

  html += "</div>"; // closes .daily-summary__scroll
  container.innerHTML = html;

  container.querySelectorAll("[data-ds-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      dailySummaryMonth = btn.dataset.dsNav;
      renderDailySummary();
    });
  });

  container.querySelector("[data-ds-toggle-bal]")?.addEventListener("click", () => {
    dailySummaryShowBalance = !dailySummaryShowBalance;
    renderDailySummary();
  });

  container.querySelectorAll("[data-ds-expand]").forEach((row) => {
    row.addEventListener("click", () => {
      const dk = row.dataset.dsExpand;
      const detail = document.getElementById(`ds-detail-${dk}`);
      if (!detail) return;
      const isHidden = detail.hidden;
      container.querySelectorAll(".daily-summary__detail").forEach((d) => { d.hidden = true; });
      container.querySelectorAll(".daily-summary__row--expanded").forEach((r) => { r.classList.remove("daily-summary__row--expanded"); });
      if (isHidden) {
        detail.hidden = false;
        row.classList.add("daily-summary__row--expanded");
      }
    });
  });
}

function getISOWeek(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function renderWeekSeparator(weekCredit, weekDebit, weekNum) {
  const weekNet = weekCredit - weekDebit;
  const netClass = weekNet >= 0 ? "positive" : "negative";
  return `<div class="daily-summary__week-sep"><span class="daily-summary__week-label">Week ${weekNum}</span><span class="daily-summary__week-total"><span class="daily-summary__week-debit">${formatMoney(weekDebit)}</span><span class="daily-summary__week-divider">/</span><span class="daily-summary__week-credit">${formatMoney(weekCredit)}</span><span class="daily-summary__week-net ${netClass}">${weekNet >= 0 ? "+" : ""}${formatMoney(Math.abs(weekNet))}</span></span></div>`;
}

// ── Spending Heatmap ────────────────────────────────────────────────────────
async function renderSpendingHeatmap() {
  const container = document.querySelector("#spendingHeatmap");
  if (!container) return;
  const { renderDailyHeatmap } = await import("./chart-engine.js");

  const visible = getVisibleExpenses();
  const month = currentMonthKey();
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

  const dailySpend = new Array(daysInMonth).fill(0);

  for (const item of visible) {
    const t = normalizeType(item.type);
    if (t === "debit" && String(item.dateKey).startsWith(month)) {
      const day = Number(String(item.dateKey).slice(8, 10));
      if (day >= 1 && day <= daysInMonth) dailySpend[day - 1] += Number(item.amount);
    }
  }

  const dailyData = dailySpend.map((amount, i) => ({ day: i + 1, amount }));
  const currentMonthLabel = new Date(month + "-01").toLocaleDateString(appSettings.locale, { month: "long", year: "numeric" });
  const heatmap = renderDailyHeatmap(dailyData, currentMonthLabel, formatMoney);

  if (!heatmap) {
    container.innerHTML = '<p class="spending-analysis__placeholder">Spend consistently to see daily patterns here.</p>';
    return;
  }

  container.innerHTML = heatmap;

  container.querySelectorAll("[data-heatmap-day]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const day = Number(cell.dataset.heatmapDay);
      showHeatmapDayDetail(day, month, container);
    });
  });

  const isCurrentMonth = month === currentMonthKey();
  if (isCurrentMonth) {
    const today = new Date().getDate();
    showHeatmapDayDetail(today, month, container);
  }
}

function showHeatmapDayDetail(day, month, container) {
  const detailEl = container.querySelector("#heatmapDayDetail");
  if (!detailEl) return;

  const dk = `${month}-${String(day).padStart(2, "0")}`;
  const visible = getVisibleExpenses();
  const dayTxns = visible.filter((item) => String(item.dateKey) === dk);

  container.querySelectorAll(".heatmap__cell--selected").forEach((c) => c.classList.remove("heatmap__cell--selected"));
  const activeCell = container.querySelector(`[data-heatmap-day="${day}"]`);
  if (activeCell) activeCell.classList.add("heatmap__cell--selected");

  if (!dayTxns.length) {
    const dayDate = new Date(dk + "T00:00:00");
    const label = dayDate.toLocaleDateString(appSettings.locale, { weekday: "long", day: "numeric", month: "short" });
    detailEl.innerHTML = `
      <div class="heatmap__detail-header">
        <span class="heatmap__detail-date">${escapeHtml(label)}</span>
        <button class="heatmap__detail-close" data-close-detail aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <p class="heatmap__detail-empty">No transactions on this day.</p>
    `;
    detailEl.hidden = false;
    detailEl.querySelector("[data-close-detail]").addEventListener("click", () => {
      detailEl.hidden = true;
      container.querySelectorAll(".heatmap__cell--selected").forEach((c) => c.classList.remove("heatmap__cell--selected"));
    });
    return;
  }

  const dayDate = new Date(dk + "T00:00:00");
  const label = dayDate.toLocaleDateString(appSettings.locale, { weekday: "long", day: "numeric", month: "short" });

  let totalDebit = 0;
  let totalCredit = 0;
  const txnRows = dayTxns.map((txn) => {
    const t = normalizeType(txn.type);
    const amt = Number(txn.amount);
    if (t === "debit") totalDebit += amt;
    else totalCredit += amt;
    const amtClass = t === "credit" ? "positive" : "negative";
    const sign = t === "credit" ? "+" : "-";
    const desc = txn.description || txn.category || "Transaction";
    return `
      <div class="heatmap__detail-txn">
        <span class="heatmap__detail-txn-cat">${escapeHtml(txn.category || "—")}</span>
        <span class="heatmap__detail-txn-desc">${escapeHtml(desc)}</span>
        <span class="heatmap__detail-txn-amt ${amtClass}">${sign}${escapeHtml(formatMoney(amt))}</span>
      </div>
    `;
  }).join("");

  detailEl.innerHTML = `
    <div class="heatmap__detail-header">
      <span class="heatmap__detail-date">${escapeHtml(label)}</span>
      <button class="heatmap__detail-close" data-close-detail aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="heatmap__detail-summary">
      <span class="heatmap__detail-spent">Spent: <strong>${escapeHtml(formatMoney(totalDebit))}</strong></span>
      ${totalCredit > 0 ? `<span class="heatmap__detail-income">Income: <strong>${escapeHtml(formatMoney(totalCredit))}</strong></span>` : ""}
    </div>
    <div class="heatmap__detail-list">${txnRows}</div>
  `;
  detailEl.hidden = false;

  detailEl.querySelector("[data-close-detail]").addEventListener("click", () => {
    detailEl.hidden = true;
    container.querySelectorAll(".heatmap__cell--selected").forEach((c) => c.classList.remove("heatmap__cell--selected"));
  });
}

// ── Income vs Expense Chart ─────────────────────────────────────────────────
async function renderIncomeExpenseChart() {
  const container = document.querySelector("#incomeExpenseChart");
  if (!container) return;
  const { renderIncomeExpenseBar } = await import("./chart-engine.js");

  const visible = getVisibleExpenses();
  const monthlyIncome = new Map();
  const monthlyExpense = new Map();

  for (const item of visible) {
    const t = normalizeType(item.type);
    const mk = String(item.dateKey).slice(0, 7);
    const amt = Number(item.amount);
    if (t === "debit") monthlyExpense.set(mk, (monthlyExpense.get(mk) || 0) + amt);
    if (t === "credit") monthlyIncome.set(mk, (monthlyIncome.get(mk) || 0) + amt);
  }

  const allMonths = new Set([...monthlyIncome.keys(), ...monthlyExpense.keys()]);
  const sortedMonths = [...allMonths].sort().slice(-6);
  const ieData = sortedMonths.map((mk) => ({
    label: new Date(mk + "-01").toLocaleDateString(appSettings.locale, { month: "short" }),
    income: monthlyIncome.get(mk) || 0,
    expense: monthlyExpense.get(mk) || 0,
  }));
  const ieChart = renderIncomeExpenseBar(ieData, formatMoney);

  if (!ieChart) {
    container.innerHTML = '<p class="spending-analysis__placeholder">Track income and expenses to compare them over time.</p>';
    return;
  }

  container.innerHTML = ieChart;
}

// ── Spending Analysis (Summary Stats) ───────────────────────────────────────
async function renderSpendingAnalysis() {
  const container = document.querySelector("#spendingAnalysis");
  if (!container) return;

  const visible = getVisibleExpenses();
  const month = currentMonthKey();

  const monthDebits = visible.filter((item) => normalizeType(item.type) === "debit" && String(item.dateKey).startsWith(month));
  const totalSpent = monthDebits.reduce((sum, item) => sum + Number(item.amount), 0);
  const txnCount = monthDebits.length;

  if (txnCount === 0) {
    container.innerHTML = '<p class="spending-analysis__placeholder">Keep tracking to see spending analysis here.</p>';
    return;
  }

  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - dayOfMonth;
  const projected = dayOfMonth > 0 ? Math.round((totalSpent / dayOfMonth) * daysInMonth) : 0;

  const categoryMap = new Map();
  for (const item of monthDebits) {
    const cat = item.category || "Uncategorized";
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + Number(item.amount));
  }
  const topCategory = [...categoryMap.entries()].sort((a, b) => b[1] - a[1])[0];

  container.innerHTML = `
    <div class="spending-stats">
      <div class="spending-stats__item">
        <span class="spending-stats__label">Transactions</span>
        <strong class="spending-stats__value">${txnCount}</strong>
      </div>
      <div class="spending-stats__item">
        <span class="spending-stats__label">Days Left</span>
        <strong class="spending-stats__value">${daysLeft}</strong>
      </div>
      <div class="spending-stats__item">
        <span class="spending-stats__label">Projected Total</span>
        <strong class="spending-stats__value">${escapeHtml(formatMoney(projected))}</strong>
      </div>
      <div class="spending-stats__item">
        <span class="spending-stats__label">Top Category</span>
        <strong class="spending-stats__value spending-stats__value--small">${escapeHtml(topCategory ? topCategory[0] : "--")}</strong>
      </div>
    </div>
  `;
}

// ── Smart Insights ─────────────────────────────────────────────────────────
async function renderInsights() {
  const container = document.querySelector("#insightAlerts");
  if (!container) return;
  const { generateInsights } = await import("./insights-engine.js");

  const insights = generateInsights(cachedExpenses, cachedAccounts, cachedBudgets, formatMoney);

  if (!insights.length) {
    container.innerHTML = '<p class="empty-state">Add more transactions to see spending insights.</p>';
    return;
  }

  const iconSvgs = {
    "trend-up": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    "trend-down": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
    "alert": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    "calendar": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    "streak": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    "forecast": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  };

  container.innerHTML = insights.map((insight) => `
    <div class="insight-card insight-card--${escapeHtml(insight.type)}">
      <div class="insight-card__icon">
        ${iconSvgs[insight.icon] || iconSvgs["alert"]}
      </div>
      <div class="insight-card__body">
        <p class="insight-card__title">${escapeHtml(insight.title)}</p>
        <p class="insight-card__desc">${escapeHtml(insight.description)}</p>
      </div>
    </div>
  `).join("");
}

// ── Transaction Rendering ───────────────────────────────────────────────────
function getAccountName(accountId) {
  if (!accountId) return "";
  const a = cachedAccounts.find((acc) => acc.id === accountId);
  return a ? a.name : "";
}

function renderTransactionItem(item) {
  const syncLabel = item.syncStatus === "synced" ? "Synced" : item.syncStatus === "error" ? "Sync failed" : "Pending";
  const type = normalizeType(item.type);
  const repeatBadge = item.recurringId ? '<span class="repeat-badge">Recurring</span>' : "";

  if (type === "adjustment") {
    const effect = Number(item.balanceEffect || 0);
    const effectStr = effect >= 0 ? `+${formatMoney(effect)}` : `-${formatMoney(Math.abs(effect))}`;
    const effectClass = effect >= 0 ? "income" : "expense";
    const accountName = getAccountName(item.accountId);
    return `
      <article class="history-item adjustment-item" data-id="${escapeHtml(item.id)}">
        <div class="history-main">
          <div class="history-title">
            <strong>Balance Correction</strong>
            <span class="${effectClass}">${escapeHtml(effectStr)}</span>
          </div>
          <p>${escapeHtml(item.reason || item.description || "Balance correction")}</p>
          <div class="history-meta">
            <span>${escapeHtml(formatDate(item.dateKey))}</span>
            ${accountName ? `<span class="account-tag">${escapeHtml(accountName)}</span>` : ""}
            <span class="sync-${escapeHtml(item.syncStatus)}">${escapeHtml(syncLabel)}</span>
            ${repeatBadge}
          </div>
        </div>
        <div class="item-actions">
          <button data-action="edit" class="small-btn">Edit</button>
          <button data-action="delete" class="small-btn danger">Delete</button>
        </div>
      </article>
    `;
  }

  if (type === "transfer") {
    const fromName = getAccountName(item.fromAccountId);
    const toName = getAccountName(item.toAccountId);
    return `
      <article class="history-item transfer-item" data-id="${escapeHtml(item.id)}">
        <div class="history-main">
          <div class="history-title">
            <strong>Transfer</strong>
            <span class="transfer-amount">${escapeHtml(formatMoney(item.amount))}</span>
          </div>
          <p>${escapeHtml(item.description || "")}</p>
          <div class="transfer-route">${escapeHtml(fromName)} &rarr; ${escapeHtml(toName)}</div>
          <div class="history-meta">
            <span>${escapeHtml(formatDate(item.dateKey))}</span>
            <span class="sync-${escapeHtml(item.syncStatus)}">${escapeHtml(syncLabel)}</span>
            ${repeatBadge}
          </div>
        </div>
        <div class="item-actions">
          <button data-action="edit" class="small-btn">Edit</button>
          <button data-action="delete" class="small-btn danger">Delete</button>
        </div>
      </article>
    `;
  }

  const accountName = getAccountName(item.accountId || item.fromAccountId || item.toAccountId);
  const isCredit = type === "credit";
  return `
    <article class="history-item" data-id="${escapeHtml(item.id)}">
      <div class="history-main">
        <div class="history-title">
          <strong>${escapeHtml(item.category || item.description || "")}</strong>
          <span class="${isCredit ? "income" : "expense"}">
            ${isCredit ? "+" : "-"}${escapeHtml(formatMoney(item.amount))}
          </span>
        </div>
        <p>${escapeHtml(item.description || "")}</p>
        <div class="history-meta">
          <span>${escapeHtml(formatDate(item.dateKey))}</span>
          ${accountName ? `<span class="account-tag">${escapeHtml(accountName)}</span>` : ""}
          <span class="sync-${escapeHtml(item.syncStatus)}">${escapeHtml(syncLabel)}</span>
          ${repeatBadge}
        </div>
      </div>
      <div class="item-actions">
        <button data-action="edit" class="small-btn">Edit</button>
        <button data-action="delete" class="small-btn danger">Delete</button>
      </div>
    </article>
  `;
}

// ── Date-Grouped History ────────────────────────────────────────────────────
function renderHistory() {
  if (!el.historyList) return;
  const search = el.searchInput ? el.searchInput.value.trim().toLowerCase() : "";
  const type = el.typeFilter ? el.typeFilter.value : "all";
  const accountFilterVal = el.accountFilter ? el.accountFilter.value : "all";
  const dateStart = el.dateRangeStart ? el.dateRangeStart.value : "";
  const dateEnd = el.dateRangeEnd ? el.dateRangeEnd.value : "";
  const minAmt = el.amountMin ? Number(el.amountMin.value) || 0 : 0;
  const maxAmt = el.amountMax ? Number(el.amountMax.value) || 0 : 0;

  const filtered = getVisibleExpenses().filter((item) => {
    const normalType = normalizeType(item.type);
    let matchesType = type === "all";
    if (type === "expense") matchesType = normalType === "debit";
    else if (type === "income") matchesType = normalType === "credit";
    else if (type === "transfer") matchesType = normalType === "transfer";
    else if (type === "adjustment") matchesType = normalType === "adjustment";

    let matchesAccount = accountFilterVal === "all";
    if (!matchesAccount) {
      matchesAccount = item.accountId === accountFilterVal || item.fromAccountId === accountFilterVal || item.toAccountId === accountFilterVal;
    }

    const matchesSearch = !search ||
      (item.description || "").toLowerCase().includes(search) ||
      (item.category || "").toLowerCase().includes(search) ||
      (item.reason || "").toLowerCase().includes(search);

    let matchesDate = true;
    if (dateStart && item.dateKey < dateStart) matchesDate = false;
    if (dateEnd && item.dateKey > dateEnd) matchesDate = false;

    let matchesAmount = true;
    if (minAmt > 0 && Number(item.amount) < minAmt) matchesAmount = false;
    if (maxAmt > 0 && Number(item.amount) > maxAmt) matchesAmount = false;

    return matchesType && matchesSearch && matchesAccount && matchesDate && matchesAmount;
  });

  const totalFiltered = filtered.length;
  const paginated = filtered.slice(0, historyDisplayCount);

  // History count
  const historyCount = document.querySelector("#historyCount");
  const historyEndMarker = document.querySelector("#historyEndMarker");

  if (historyCount) {
    historyCount.textContent = `Showing ${paginated.length} of ${totalFiltered} transactions`;
  }

  if (!filtered.length) {
    el.historyList.innerHTML = '<p class="empty-state">No matching records.</p>';
    if (historyEndMarker) historyEndMarker.classList.add("hidden");
    return;
  }

  // Group by date
  const groups = new Map();
  for (const item of paginated) {
    const dk = item.dateKey || "Unknown";
    if (!groups.has(dk)) groups.set(dk, []);
    groups.get(dk).push(item);
  }

  let html = "";
  for (const [dateKey, items] of groups) {
    html += `<div class="date-group"><span class="date-group-label">${escapeHtml(formatDateGroup(dateKey))}</span></div>`;
    html += items.map((item) => renderTransactionItem(item)).join("");
  }

  el.historyList.innerHTML = html;
  if (historyDisplayCount < totalFiltered) {
    const loadMoreHtml = `<button type="button" class="load-more-btn" id="historyLoadMoreBtn">Load more (${totalFiltered - historyDisplayCount} remaining)</button>`;
    el.historyList.insertAdjacentHTML("beforeend", loadMoreHtml);
  }
  if (historyEndMarker) historyEndMarker.classList.toggle("hidden", historyDisplayCount < totalFiltered);
}

// ── Sync State ──────────────────────────────────────────────────────────────
function renderSyncState() {
  const pendingTx = cachedExpenses.filter((item) => item.syncStatus === "pending" || item.syncStatus === "error").length;
  const pendingAcct = cachedAccounts.filter((item) => item.syncStatus === "pending" || item.syncStatus === "error").length;
  const pending = pendingTx + pendingAcct;
  el.syncBadge.textContent = isSyncing ? "Syncing..." : `${pending} pending`;
  el.syncBadge.classList.toggle("pending", pending > 0);
}

// ── Cloud Sync ──────────────────────────────────────────────────────────────
function stripLocalOnlyFields(record) {
  const { syncStatus, lastSyncError, syncedAt, ...cloudRecord } = record;
  return cloudRecord;
}

function withTimeout(promise, milliseconds = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Sync timed out.")), milliseconds)),
  ]);
}

async function syncPendingRecords() {
  if (isSyncing || !currentUser || !navigator.onLine || !firestore) {
    await refreshUI();
    return;
  }

  isSyncing = true;
  renderSyncState();

  const pendingAccounts = await getPendingAccounts();
  for (const account of pendingAccounts) {
    try {
      const reference = doc(firestore, "users", currentUser.uid, "accounts", account.id);
      await withTimeout(setDoc(reference, stripLocalOnlyFields(account), { merge: true }));
      await markAccountSynced(account.id);
    } catch (error) {
      await markAccountSyncError(account.id, error.message);
    }
  }

  const pending = await getPendingExpenses();
  for (const expense of pending) {
    try {
      const reference = doc(firestore, "users", currentUser.uid, "transactions", expense.id);
      await withTimeout(setDoc(reference, stripLocalOnlyFields(expense), { merge: true }));
      await markExpenseSynced(expense.id);
    } catch (error) {
      await markExpenseSyncError(expense.id, error.message);
    }
  }

  isSyncing = false;
  updateLastSynced();
  await refreshUI();
}

function startCloudListener(user) {
  if (cloudUnsubscribe) cloudUnsubscribe();
  const unsubList = [];

  async function reconcileSnapshot(snapshot) {
    const localExpenses = await getAllExpenses();
    const localMap = new Map(localExpenses.map((e) => [e.id, e]));
    const incoming = [];
    for (const cloudDoc of snapshot.docs) {
      const remote = { id: cloudDoc.id, ...cloudDoc.data(), syncStatus: "synced", lastSyncError: "", syncedAt: new Date().toISOString() };
      const local = localMap.get(remote.id);
      if (!local || local.syncStatus === "synced" || String(remote.updatedAt) >= String(local.updatedAt)) {
        incoming.push(remote);
      }
    }
    if (incoming.length) { await bulkPutExpenses(incoming); await refreshUI(); }
  }

  const txQuery = query(collection(firestore, "users", user.uid, "transactions"), orderBy("occurredAt", "desc"));
  unsubList.push(
    onSnapshot(txQuery, { includeMetadataChanges: true }, reconcileSnapshot, (error) => console.error("Cloud transactions listener error:", error))
  );

  const expensesQuery = query(collection(firestore, "users", user.uid, "expenses"), orderBy("occurredAt", "desc"));
  unsubList.push(
    onSnapshot(expensesQuery, { includeMetadataChanges: true }, reconcileSnapshot, (error) => console.error("Cloud expenses listener error:", error))
  );

  const accountsQuery = query(collection(firestore, "users", user.uid, "accounts"), orderBy("updatedAt", "desc"));
  unsubList.push(
    onSnapshot(accountsQuery, { includeMetadataChanges: true }, async (snapshot) => {
      for (const cloudDoc of snapshot.docs) {
        const remote = { id: cloudDoc.id, ...cloudDoc.data(), syncStatus: "synced", lastSyncError: "", syncedAt: new Date().toISOString() };
        const local = await getAccount(remote.id);
        if (!local || local.syncStatus === "synced" || String(remote.updatedAt) >= String(local.updatedAt)) {
          await putAccount(remote);
        }
      }
      await refreshUI();
    }, (error) => console.error("Cloud accounts listener error:", error))
  );

  cloudUnsubscribe = () => unsubList.forEach((u) => u());
}

// ── Transaction Composer ────────────────────────────────────────────────────
function getSelectedTxType() {
  if (el.txTypeCredit && el.txTypeCredit.classList.contains("active")) return "credit";
  if (el.txTypeTransfer && el.txTypeTransfer.classList.contains("active")) return "transfer";
  return "debit";
}

function setTxType(type) {
  [el.txTypeDebit, el.txTypeCredit, el.txTypeTransfer].forEach((btn) => {
    if (btn) btn.classList.remove("active");
  });
  if (type === "debit" && el.txTypeDebit) el.txTypeDebit.classList.add("active");
  if (type === "credit" && el.txTypeCredit) el.txTypeCredit.classList.add("active");
  if (type === "transfer" && el.txTypeTransfer) el.txTypeTransfer.classList.add("active");

  if (el.txSingleAccountGroup && el.txTransferAccountGroup) {
    if (type === "transfer") {
      el.txSingleAccountGroup.classList.add("hidden");
      el.txTransferAccountGroup.classList.remove("hidden");
      if (el.txCategoryGroup) el.txCategoryGroup.classList.add("hidden");
    } else {
      el.txSingleAccountGroup.classList.remove("hidden");
      el.txTransferAccountGroup.classList.add("hidden");
      if (el.txCategoryGroup) el.txCategoryGroup.classList.remove("hidden");
    }
  }
}

let defaultAccountId = null;

async function loadDefaultAccount() {
  defaultAccountId = await getSetting("defaultAccountId");
}

function populateAccountDropdowns() {
  const activeAccounts = cachedAccounts.filter((a) => a.archived !== true);
  const buildOptions = (selectEl, includeEmpty = true) => {
    if (!selectEl) return;
    const currentVal = selectEl.value;
    selectEl.innerHTML = "";
    if (includeEmpty) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Select account";
      selectEl.appendChild(opt);
    }
    for (const a of activeAccounts) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name;
      selectEl.appendChild(opt);
    }
    // Restore the user's current selection if it still exists
    if (currentVal && [...selectEl.options].some((o) => o.value === currentVal)) {
      selectEl.value = currentVal;
    } else if (defaultAccountId && [...selectEl.options].some((o) => o.value === defaultAccountId)) {
      selectEl.value = defaultAccountId;
    } else if (activeAccounts.length === 1) {
      selectEl.value = activeAccounts[0].id;
    }
  };

  buildOptions(el.txAccount);
  buildOptions(el.txFromAccount);
  buildOptions(el.txToAccount);

  if (el.accountFilter) {
    const currentFilter = el.accountFilter.value;
    el.accountFilter.innerHTML = '<option value="all">All Accounts</option>';
    for (const a of activeAccounts) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name;
      el.accountFilter.appendChild(opt);
    }
    if (currentFilter && [...el.accountFilter.options].some((o) => o.value === currentFilter)) {
      el.accountFilter.value = currentFilter;
    }
  }

  // Populate default account selector in settings
  const defaultSelect = document.querySelector("#defaultAccountSelect");
  if (defaultSelect) {
    const current = defaultSelect.value;
    defaultSelect.innerHTML = '<option value="">No default (ask every time)</option>';
    for (const a of activeAccounts) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.name;
      defaultSelect.appendChild(opt);
    }
    if (defaultAccountId && [...defaultSelect.options].some((o) => o.value === defaultAccountId)) {
      defaultSelect.value = defaultAccountId;
    } else if (current) {
      defaultSelect.value = current;
    }
  }
}

async function handleTransactionSubmit(event) {
  event.preventDefault();
  const txType = getSelectedTxType();
  const amount = Number(el.txAmount.value);
  const description = el.txDescription.value.trim();
  const category = el.txCategory ? el.txCategory.value : "Other";
  const dateKey = el.txDate.value || localDateKey();
  const repeat = el.txRepeat ? el.txRepeat.value : "none";
  const now = new Date().toISOString();

  const amountGroup = document.getElementById("txAmountGroup");
  const amountErr = document.getElementById("txAmountError");
  const descField = document.getElementById("txDescriptionField");
  const descErr = document.getElementById("txDescriptionError");
  const acctGroup = document.getElementById("txSingleAccountGroup");
  const acctErr = document.getElementById("txAccountError");
  const fromField = document.getElementById("txFromAccountField");
  const fromErr = document.getElementById("txFromAccountError");
  const toField = document.getElementById("txToAccountField");
  const toErr = document.getElementById("txToAccountError");

  clearFieldError(amountGroup, amountErr);
  clearFieldError(descField, descErr);
  clearFieldError(acctGroup, acctErr);
  clearFieldError(fromField, fromErr);
  clearFieldError(toField, toErr);
  showMessage(el.composerMessage, "");

  let hasError = false;
  if (!amount || amount <= 0) {
    setFieldError(amountGroup, amountErr, "Amount must be greater than zero.");
    hasError = true;
  }
  if (!description) {
    setFieldError(descField, descErr, "Please enter a description.");
    hasError = true;
  }

  let transaction;

  if (txType === "transfer") {
    const fromId = el.txFromAccount.value;
    const toId = el.txToAccount.value;
    if (!fromId) { setFieldError(fromField, fromErr, "Select source account."); hasError = true; }
    if (!toId) { setFieldError(toField, toErr, "Select destination account."); hasError = true; }
    if (hasError) return;
    if (fromId === toId) { setFieldError(toField, toErr, "Source and destination cannot be the same."); return; }

    const fromBalance = getAccountBalance(fromId);
    if (amount > fromBalance) {
      const ok = await showConfirm("Insufficient Balance", `Current balance: ${formatMoney(fromBalance)}. After: ${formatMoney(fromBalance - amount)}. Continue?`);
      if (!ok) return;
    }

    transaction = {
      id: crypto.randomUUID(), type: "transfer", amount, accountId: null,
      fromAccountId: fromId, toAccountId: toId, category: "Transfer", description, dateKey,
      occurredAt: `${dateKey}T${new Date().toISOString().slice(11, 23)}Z`,
      createdAt: now, updatedAt: now, deleted: false, syncStatus: "pending", lastSyncError: "",
    };
    lastSelectedAccountId = fromId;
  } else {
    const accountId = el.txAccount.value;
    if (!accountId) { setFieldError(acctGroup, acctErr, "Please select an account."); hasError = true; }
    if (hasError) return;

    if (txType === "debit") {
      const currentBalance = getAccountBalance(accountId);
      if (amount > currentBalance) {
        const ok = await showConfirm("Insufficient Balance", `Current: ${formatMoney(currentBalance)}. After: ${formatMoney(currentBalance - amount)}. Continue?`);
        if (!ok) return;
      }
    }

    transaction = {
      id: crypto.randomUUID(), type: txType, amount, accountId,
      fromAccountId: txType === "debit" ? accountId : null,
      toAccountId: txType === "credit" ? accountId : null,
      category: txType === "transfer" ? "Transfer" : category, description, dateKey,
      occurredAt: `${dateKey}T${new Date().toISOString().slice(11, 23)}Z`,
      createdAt: now, updatedAt: now, deleted: false, syncStatus: "pending", lastSyncError: "",
    };
    lastSelectedAccountId = accountId;
  }

  await putExpense(transaction);
  logAudit("expense", transaction.id, "create", null, transaction);

  // Handle recurring
  if (repeat !== "none") {
    const recurring = {
      id: crypto.randomUUID(),
      templateTransaction: { ...transaction, id: null },
      frequency: repeat,
      nextOccurrence: calculateNextOccurrence(dateKey, repeat),
      active: true,
      createdAt: now,
    };
    await putRecurring(recurring);
    transaction.recurringId = recurring.id;
    await putExpense(transaction);
  }

  // Reset form
  el.txAmount.value = "";
  el.txDescription.value = "";
  if (el.txCategory) el.txCategory.value = "Other";
  el.txDate.value = localDateKey();
  if (el.txRepeat) el.txRepeat.value = "none";
  showMessage(el.composerMessage, "");

  await refreshUI();
  haptic("success");
  showSuccessAnimation(document.querySelector(".tx-form-card"));
  showToast("Saved on this device.");
  syncPendingRecords();
}

// ── Quick Add ───────────────────────────────────────────────────────────────
async function handleQuickAdd() {
  const text = el.quickAddInput.value.trim();
  if (!text) { showToast("Type something like: Lunch 150 UPI"); return; }

  const parsed = parseExpense(text);
  if (!parsed.valid) { showToast(parsed.error); return; }

  const activeAccounts = cachedAccounts.filter((a) => a.archived !== true);
  const accountId = defaultAccountId || (activeAccounts.length ? activeAccounts[0].id : null);
  if (!accountId) { showToast("Create an account first."); return; }

  const now = new Date().toISOString();
  const txType = parsed.type === "income" ? "credit" : "debit";

  const transaction = {
    id: crypto.randomUUID(),
    type: txType,
    amount: parsed.amount,
    accountId,
    fromAccountId: txType === "debit" ? accountId : null,
    toAccountId: txType === "credit" ? accountId : null,
    category: parsed.category,
    description: parsed.description,
    dateKey: parsed.dateKey,
    occurredAt: parsed.occurredAt,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    syncStatus: "pending",
    lastSyncError: "",
  };

  await putExpense(transaction);
  logAudit("expense", transaction.id, "create", null, transaction);
  lastSelectedAccountId = accountId;
  el.quickAddInput.value = "";
  await refreshUI();
  haptic("success");
  showSuccessAnimation(document.querySelector(".add-panel"));
  showToast(`${txType === "credit" ? "Credit" : "Debit"} of ${formatMoney(parsed.amount)} saved.`);
  syncPendingRecords();
}

// ── Recurring Transactions ──────────────────────────────────────────────────
function calculateNextOccurrence(fromDate, frequency) {
  const date = new Date(fromDate + "T00:00:00");
  switch (frequency) {
    case "daily": date.setDate(date.getDate() + 1); break;
    case "weekly": date.setDate(date.getDate() + 7); break;
    case "monthly": date.setMonth(date.getMonth() + 1); break;
    case "yearly": date.setFullYear(date.getFullYear() + 1); break;
  }
  return localDateKey(date);
}

async function processRecurringTransactions() {
  const active = await getActiveRecurring();
  const today = localDateKey();
  const now = new Date().toISOString();

  for (const rec of active) {
    let next = rec.nextOccurrence;
    while (next && next <= today) {
      const tx = {
        ...rec.templateTransaction,
        id: crypto.randomUUID(),
        dateKey: next,
        occurredAt: `${next}T08:00:00.000Z`,
        createdAt: now,
        updatedAt: now,
        syncStatus: "pending",
        lastSyncError: "",
        recurringId: rec.id,
      };
      await putExpense(tx);
      next = calculateNextOccurrence(next, rec.frequency);
    }
    if (next !== rec.nextOccurrence) {
      await putRecurring({ ...rec, nextOccurrence: next });
    }
  }
}

// ── Edit/Delete Transactions ────────────────────────────────────────────────
async function editExpense(id) {
  const existing = await getExpense(id);
  if (!existing) return;
  if (normalizeType(existing.type) === "adjustment") { openEditAdjustmentModal(existing); return; }
  openEditTransactionModal(existing);
}

function openEditTransactionModal(tx) {
  const modal = document.querySelector("#editTransactionModal");
  if (!modal) return;
  const type = normalizeType(tx.type);
  modal.dataset.editingId = tx.id;

  const editType = modal.querySelector("#editTxType");
  const editAccount = modal.querySelector("#editTxAccount");
  const editFromAccount = modal.querySelector("#editTxFromAccount");
  const editToAccount = modal.querySelector("#editTxToAccount");
  const editAmount = modal.querySelector("#editTxAmount");
  const editDesc = modal.querySelector("#editTxDescription");
  const editCategory = modal.querySelector("#editTxCategory");
  const editDate = modal.querySelector("#editTxDate");
  const singleGroup = modal.querySelector("#editTxSingleAccountGroup");
  const transferGroup = modal.querySelector("#editTxTransferAccountGroup");
  const categoryGroup = modal.querySelector("#editTxCategoryGroup");

  if (editType) editType.value = type;
  const activeAccounts = cachedAccounts.filter((a) => a.archived !== true);
  [editAccount, editFromAccount, editToAccount].forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = '<option value="">Select account</option>';
    for (const a of activeAccounts) { const opt = document.createElement("option"); opt.value = a.id; opt.textContent = a.name; sel.appendChild(opt); }
  });

  if (type === "transfer") {
    if (singleGroup) singleGroup.classList.add("hidden");
    if (transferGroup) transferGroup.classList.remove("hidden");
    if (categoryGroup) categoryGroup.classList.add("hidden");
    if (editFromAccount) editFromAccount.value = tx.fromAccountId || "";
    if (editToAccount) editToAccount.value = tx.toAccountId || "";
  } else {
    if (singleGroup) singleGroup.classList.remove("hidden");
    if (transferGroup) transferGroup.classList.add("hidden");
    if (categoryGroup) categoryGroup.classList.remove("hidden");
    if (editAccount) editAccount.value = tx.accountId || "";
  }

  if (editAmount) editAmount.value = tx.amount || "";
  if (editDesc) editDesc.value = tx.description || "";
  if (editCategory) editCategory.value = tx.category || "Other";
  if (editDate) editDate.value = tx.dateKey || localDateKey();

  if (editType) {
    editType.onchange = () => {
      if (editType.value === "transfer") {
        if (singleGroup) singleGroup.classList.add("hidden");
        if (transferGroup) transferGroup.classList.remove("hidden");
        if (categoryGroup) categoryGroup.classList.add("hidden");
      } else {
        if (singleGroup) singleGroup.classList.remove("hidden");
        if (transferGroup) transferGroup.classList.add("hidden");
        if (categoryGroup) categoryGroup.classList.remove("hidden");
      }
    };
  }
  openModal(modal);
}

async function saveEditedTransaction() {
  const modal = document.querySelector("#editTransactionModal");
  if (!modal) return;
  const id = modal.dataset.editingId;
  const existing = await getExpense(id);
  if (!existing) return;

  const editType = modal.querySelector("#editTxType");
  const editAccount = modal.querySelector("#editTxAccount");
  const editFromAccount = modal.querySelector("#editTxFromAccount");
  const editToAccount = modal.querySelector("#editTxToAccount");
  const editAmount = modal.querySelector("#editTxAmount");
  const editDesc = modal.querySelector("#editTxDescription");
  const editCategory = modal.querySelector("#editTxCategory");
  const editDate = modal.querySelector("#editTxDate");
  const editMsg = modal.querySelector("#editTxMessage");

  const type = editType ? editType.value : normalizeType(existing.type);
  const amount = Number(editAmount.value);
  const description = editDesc.value.trim();
  const category = editCategory ? editCategory.value : existing.category;
  const dateKey = editDate ? editDate.value : existing.dateKey;

  if (!amount || amount <= 0) { showMessage(editMsg, "Amount must be greater than zero.", true); return; }
  if (!description) { showMessage(editMsg, "Description is required.", true); return; }

  const now = new Date().toISOString();
  let updated;

  if (type === "transfer") {
    const fromId = editFromAccount ? editFromAccount.value : "";
    const toId = editToAccount ? editToAccount.value : "";
    if (!fromId || !toId) { showMessage(editMsg, "Both accounts are required.", true); return; }
    if (fromId === toId) { showMessage(editMsg, "Source and destination cannot be the same.", true); return; }
    updated = { ...existing, type: "transfer", amount, accountId: null, fromAccountId: fromId, toAccountId: toId, category: "Transfer", description, dateKey, occurredAt: `${dateKey}T${new Date().toISOString().slice(11, 23)}Z`, updatedAt: now, syncStatus: "pending", lastSyncError: "" };
  } else {
    const accountId = editAccount ? editAccount.value : "";
    if (!accountId) { showMessage(editMsg, "Please select an account.", true); return; }
    updated = { ...existing, type, amount, accountId, fromAccountId: type === "debit" ? accountId : null, toAccountId: type === "credit" ? accountId : null, category, description, dateKey, occurredAt: `${dateKey}T${new Date().toISOString().slice(11, 23)}Z`, updatedAt: now, syncStatus: "pending", lastSyncError: "" };
  }

  await putExpense(updated);
  logAudit("expense", updated.id, "update", existing, updated);
  closeModal(modal);
  await refreshUI();
  if (activityViewAccountId) {
    renderAccountActivity(activityViewAccountId);
    const balance = getAccountBalance(activityViewAccountId);
    el.accountActivityBalance.textContent = formatMoney(balance);
    openModal(el.accountActivityModal);
  }
  syncPendingRecords();
  showToast("Transaction updated.");
}

async function deleteExpense(id) {
  const existing = await getExpense(id);
  if (!existing) return;
  const confirmed = await showConfirm("Delete Transaction", `Delete "${existing.description || "this transaction"}"?`);
  if (!confirmed) return;

  await putExpense({ ...existing, deleted: true, updatedAt: new Date().toISOString(), syncStatus: "pending", lastSyncError: "" });
  logAudit("expense", id, "delete", existing, null);
  await refreshUI();
  syncPendingRecords();
}

// ── Accounts Rendering ──────────────────────────────────────────────────────
function renderAccounts() {
  if (!el.accountsList) return;
  const TYPE_LABELS = { cash: "Cash", bank: "Bank Account", savings: "Savings", credit: "Credit Card", wallet: "Wallet", other: "Other" };

  const renderCard = (account) => {
    const balance = getAccountBalance(account.id);
    const syncLabel = account.syncStatus === "synced" ? "Synced" : account.syncStatus === "error" ? "Sync failed" : "Pending";
    const typeLabel = TYPE_LABELS[account.type] || account.type || "";
    const balanceClass = balance < 0 ? "negative-balance" : "";
    return `
      <article class="account-card${account.archived ? " archived" : ""}" data-account-id="${escapeHtml(account.id)}">
        <div class="account-card-header">
          <div class="account-card-title">
            <strong class="account-name">${escapeHtml(account.name)}</strong>
            ${account.alias ? `<span class="account-alias">${escapeHtml(account.alias)}</span>` : ""}
          </div>
          <div class="account-card-badges">
            <span class="account-type-badge">${escapeHtml(typeLabel)}</span>
            <span class="sync-${escapeHtml(account.syncStatus)} account-sync-badge">${escapeHtml(syncLabel)}</span>
          </div>
        </div>
        <div class="account-balance ${balanceClass}">
          <span class="balance-label">Current Balance</span>
          <strong class="balance-amount">${escapeHtml(formatMoney(balance))}</strong>
        </div>
        <div class="account-card-actions">
          <button class="small-btn" data-action="view-activity">Activity</button>
          <button class="small-btn" data-action="edit-account">Edit</button>
          <button class="small-btn primary-btn" data-action="edit-balance">Edit Balance</button>
        </div>
      </article>
    `;
  };

  const active = cachedAccounts.filter((a) => !a.archived);
  const archived = cachedAccounts.filter((a) => a.archived);

  // Net Worth card
  const netWorthValue = document.querySelector("#netWorthValue");
  const netWorthAccounts = document.querySelector("#netWorthAccounts");
  if (netWorthValue) {
    const totalBalance = active.reduce((sum, a) => sum + getAccountBalance(a.id), 0);
    netWorthValue.textContent = formatMoney(totalBalance);
    if (netWorthAccounts) netWorthAccounts.textContent = `across ${active.length} account${active.length !== 1 ? "s" : ""}`;
  }

  if (!cachedAccounts.length) {
    el.accountsList.innerHTML = '<p class="empty-state">No accounts yet. Add an account to track balances.</p>';
    return;
  }

  let html = active.map(renderCard).join("");
  if (archived.length) {
    html += `<details class="archived-accounts"><summary>${archived.length} archived account${archived.length > 1 ? "s" : ""}</summary><div class="accounts-grid archived-grid">${archived.map(renderCard).join("")}</div></details>`;
  }
  el.accountsList.innerHTML = html;
}

// ── Adjustments Summary ─────────────────────────────────────────────────────
function renderAdjustmentsSummary() {
  if (!el.adjustmentsSummary) return;
  const adjustments = cachedExpenses.filter((t) => normalizeType(t.type) === "adjustment" && !t.deleted);
  if (!adjustments.length) { el.adjustmentsSummary.classList.add("hidden"); return; }
  el.adjustmentsSummary.classList.remove("hidden");

  let totalPositive = 0, totalNegative = 0, positiveCount = 0, negativeCount = 0;
  for (const adj of adjustments) {
    const effect = Number(adj.balanceEffect || 0);
    if (effect > 0) { totalPositive += effect; positiveCount++; }
    else if (effect < 0) { totalNegative += Math.abs(effect); negativeCount++; }
  }

  el.adjustmentsSummaryContent.innerHTML = `
    <div class="adj-stats">
      <div class="adj-stat"><span>Positive (${positiveCount})</span><strong class="income">+${escapeHtml(formatMoney(totalPositive))}</strong></div>
      <div class="adj-stat"><span>Negative (${negativeCount})</span><strong class="expense">-${escapeHtml(formatMoney(totalNegative))}</strong></div>
      <div class="adj-stat"><span>Total</span><strong>${adjustments.length}</strong></div>
    </div>
  `;
}

// ── Modal Helpers ───────────────────────────────────────────────────────────
function openModal(modalEl) {
  modalEl.classList.remove("hidden");
  document.body.classList.add("modal-open");
  if (modalEl === el.accountActivityModal) {
    document.body.classList.add("account-activity-open");
    history.pushState({ accountActivity: true }, "");
  }
  trapFocus(modalEl);
}

function trapFocus(modal) {
  const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  first.focus();

  modal._trapHandler = (e) => {
    if (e.key !== "Tab") return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  modal.addEventListener("keydown", modal._trapHandler);
}

let closingFromPopstate = false;

function closeModal(modalEl) {
  if (modalEl._trapHandler) { modalEl.removeEventListener("keydown", modalEl._trapHandler); modalEl._trapHandler = null; }
  modalEl.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (modalEl === el.accountActivityModal) {
    document.body.classList.remove("account-activity-open");
    if (!closingFromPopstate) history.back();
  }
}

// ── Account Modal ───────────────────────────────────────────────────────────
function openAddAccountModal() {
  editingAccountId = null;
  el.accountModalTitle.textContent = "Add Account";
  el.accountNameInput.value = "";
  el.accountTypeInput.value = "cash";
  el.accountOpeningBalance.value = "0";
  el.accountOpeningDate.value = localDateKey();
  el.accountAlias.value = "";
  el.accountArchivedField.style.display = "none";
  el.editOpeningBalanceBtn.style.display = "none";
  showMessage(el.accountModalMessage, "");
  openModal(el.accountModal);
  el.accountNameInput.focus();
}

function openEditAccountModal(accountId) {
  const account = cachedAccounts.find((a) => a.id === accountId);
  if (!account) return;
  editingAccountId = accountId;
  el.accountModalTitle.textContent = "Edit Account";
  el.accountNameInput.value = account.name || "";
  el.accountTypeInput.value = account.type || "cash";
  el.accountOpeningBalance.value = String(account.openingBalance ?? 0);
  el.accountOpeningDate.value = account.openingDate || localDateKey();
  el.accountAlias.value = account.alias || "";
  el.accountArchivedField.style.display = "flex";
  el.accountArchivedCheck.checked = !!account.archived;
  el.editOpeningBalanceBtn.style.display = "inline-flex";
  showMessage(el.accountModalMessage, "");
  openModal(el.accountModal);
  el.accountNameInput.focus();
}

async function saveAccount() {
  const name = el.accountNameInput.value.trim();
  const nameField = el.accountNameInput.closest(".form-field");
  const nameErr = document.getElementById("accountNameError");
  clearFieldError(nameField, nameErr);
  showMessage(el.accountModalMessage, "");
  if (!name) { setFieldError(nameField, nameErr, "Account name is required."); return; }

  const now = new Date().toISOString();
  const oldAccount = editingAccountId ? cachedAccounts.find((a) => a.id === editingAccountId) : null;
  const account = {
    id: editingAccountId || crypto.randomUUID(),
    name,
    type: el.accountTypeInput.value,
    openingBalance: Number(el.accountOpeningBalance.value || 0),
    openingDate: el.accountOpeningDate.value || localDateKey(),
    alias: el.accountAlias.value.trim(),
    archived: editingAccountId ? el.accountArchivedCheck.checked : false,
    createdAt: oldAccount?.createdAt || now,
    updatedAt: now,
    syncStatus: "pending",
    lastSyncError: "",
  };

  await putAccount(account);
  logAudit("account", account.id, editingAccountId ? "update" : "create", oldAccount, account);
  closeModal(el.accountModal);
  await refreshUI();
  syncPendingRecords();
  showToast(`Account "${name}" ${editingAccountId ? "updated" : "created"}.`);

  // Close onboarding if active
  if (el.onboardingOverlay && !el.onboardingOverlay.classList.contains("hidden")) {
    showOnboardingStep(3);
  }
}

// ── Edit Balance Modal ──────────────────────────────────────────────────────
function openEditBalanceModal(accountId) {
  const account = cachedAccounts.find((a) => a.id === accountId);
  if (!account) return;
  editingAdjustmentId = null;
  adjustmentTargetAccountId = accountId;
  const balance = getAccountBalance(accountId);
  el.editBalanceAccountName.textContent = account.name;
  el.editBalanceCurrentAmt.textContent = formatMoney(balance);
  el.editBalanceActual.value = balance.toFixed(2);
  el.editBalanceReason.value = "";
  el.editBalanceDate.value = localDateKey();
  showMessage(el.editBalanceMessage, "");
  openModal(el.editBalanceModal);
  el.editBalanceActual.select();
}

function openEditAdjustmentModal(adjustment) {
  const account = cachedAccounts.find((a) => a.id === adjustment.accountId);
  if (!account) return;
  editingAdjustmentId = adjustment.id;
  adjustmentTargetAccountId = adjustment.accountId;
  el.editBalanceAccountName.textContent = account.name;
  el.editBalanceCurrentAmt.textContent = formatMoney(adjustment.previousBalance);
  el.editBalanceActual.value = String(adjustment.actualBalance ?? "");
  el.editBalanceReason.value = adjustment.reason || "";
  el.editBalanceDate.value = adjustment.dateKey || localDateKey();
  showMessage(el.editBalanceMessage, "");
  openModal(el.editBalanceModal);
  el.editBalanceActual.select();
}

async function saveBalanceAdjustment() {
  const actualStr = el.editBalanceActual.value.trim();
  if (actualStr === "" || !Number.isFinite(Number(actualStr))) { showMessage(el.editBalanceMessage, "Enter a valid amount.", true); return; }

  const actualBalance = Number(actualStr);
  const accountId = adjustmentTargetAccountId;
  const account = cachedAccounts.find((a) => a.id === accountId);
  if (!account) return;

  let previousBalance;
  if (editingAdjustmentId) {
    const existing = await getExpense(editingAdjustmentId);
    previousBalance = existing ? Number(existing.previousBalance || 0) : getAccountBalance(accountId);
  } else {
    previousBalance = getAccountBalance(accountId);
  }

  const balanceEffect = actualBalance - previousBalance;
  if (balanceEffect === 0) { showMessage(el.editBalanceMessage, "No adjustment needed.", true); return; }

  const reason = el.editBalanceReason.value.trim();
  const dateKey = el.editBalanceDate.value || localDateKey();
  const now = new Date().toISOString();
  let createdAt = now;
  if (editingAdjustmentId) { const existing = await getExpense(editingAdjustmentId); createdAt = existing?.createdAt || now; }

  const adjustment = {
    id: editingAdjustmentId || crypto.randomUUID(),
    type: "adjustment", adjustmentType: balanceEffect > 0 ? "positive" : "negative",
    amount: Math.abs(balanceEffect), accountId, fromAccountId: null, toAccountId: null,
    previousBalance, actualBalance, balanceEffect, description: "Balance correction", reason,
    category: "Adjustment", dateKey, occurredAt: `${dateKey}T00:00:00.000Z`,
    createdAt, updatedAt: now, deleted: false, syncStatus: "pending", lastSyncError: "",
  };

  await putExpense(adjustment);
  logAudit("expense", adjustment.id, editingAdjustmentId ? "update" : "create", null, adjustment);
  closeModal(el.editBalanceModal);
  await refreshUI();
  syncPendingRecords();
  showToast(`Balance adjusted for ${account.name}.`);
}

// ── Edit Opening Balance ────────────────────────────────────────────────────
async function openEditOpeningBalanceModal(accountId) {
  const account = cachedAccounts.find((a) => a.id === accountId);
  if (!account) return;
  adjustmentTargetAccountId = accountId;
  el.editOpeningAccountName.textContent = account.name;
  el.editOpeningCurrentAmt.textContent = formatMoney(account.openingBalance || 0);
  el.editOpeningNewBalance.value = String(account.openingBalance || 0);
  showMessage(el.editOpeningMessage, "");
  const hasTx = cachedExpenses.some((t) => (t.accountId === accountId || t.fromAccountId === accountId || t.toAccountId === accountId) && !t.deleted);
  el.editOpeningWarning.classList.toggle("hidden", !hasTx);
  openModal(el.editOpeningBalanceModal);
  el.editOpeningNewBalance.select();
}

async function saveOpeningBalance() {
  const newBalStr = el.editOpeningNewBalance.value.trim();
  if (newBalStr === "" || !Number.isFinite(Number(newBalStr))) { showMessage(el.editOpeningMessage, "Enter a valid balance.", true); return; }

  const accountId = adjustmentTargetAccountId;
  const account = cachedAccounts.find((a) => a.id === accountId);
  if (!account) return;
  const newBalance = Number(newBalStr);
  const now = new Date().toISOString();

  await putAccount({ ...account, openingBalance: newBalance, updatedAt: now, syncStatus: "pending", lastSyncError: "" });
  closeModal(el.editOpeningBalanceModal);
  await refreshUI();
  syncPendingRecords();
  showToast(`Opening balance updated to ${formatMoney(newBalance)}.`);
}

// ── Account Activity ────────────────────────────────────────────────────────
let chatForceType = null;

function openAccountActivityModal(accountId) {
  const account = cachedAccounts.find((a) => a.id === accountId);
  if (!account) return;
  activityViewAccountId = accountId;
  chatForceType = null;
  updateChatTypeIndicator();

  const balance = getAccountBalance(accountId);
  el.accountActivityTitle.textContent = account.name;
  el.accountActivityBalance.textContent = formatMoney(balance);

  const avatar = document.querySelector("#chatAccountAvatar");
  if (avatar) avatar.textContent = account.name.charAt(0).toUpperCase();

  renderAccountActivity(accountId);
  openModal(el.accountActivityModal);

  const chatInput = document.querySelector("#chatInput");
  if (chatInput) setTimeout(() => chatInput.focus(), 100);
}

function renderAccountActivity(accountId) {
  if (!el.accountActivityList) return;
  const account = cachedAccounts.find((a) => a.id === accountId);
  const transactions = cachedExpenses.filter((t) => !t.deleted && (t.accountId === accountId || t.fromAccountId === accountId || t.toAccountId === accountId))
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));

  if (!transactions.length) {
    el.accountActivityList.innerHTML = `
      <div class="chat-empty">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p>No transactions yet.<br/>Type below to add one!</p>
      </div>
    `;
    return;
  }

  const balanceMap = calculateBalanceAfterEachTransaction(account, cachedExpenses);
  let html = "";
  let lastDateKey = "";

  for (const item of transactions) {
    // Date divider
    if (item.dateKey !== lastDateKey) {
      lastDateKey = item.dateKey;
      html += `<div class="chat-date-divider"><span>${escapeHtml(formatDateGroup(item.dateKey))}</span></div>`;
    }

    const type = normalizeType(item.type);
    const balanceAfter = balanceMap.get(item.id);
    const balanceStr = balanceAfter != null ? formatMoney(balanceAfter) : "";

    if (type === "adjustment") {
      const effect = Number(item.balanceEffect || 0);
      html += `
        <div class="chat-bubble chat-bubble--adjustment">
          Balance corrected ${effect >= 0 ? "+" : ""}${escapeHtml(formatMoney(effect))}
          ${item.reason ? ` &mdash; ${escapeHtml(item.reason)}` : ""}
        </div>
      `;
      continue;
    }

    if (type === "transfer") {
      const fromName = getAccountName(item.fromAccountId);
      const toName = getAccountName(item.toAccountId);
      const direction = item.fromAccountId === accountId ? "out" : "in";
      html += `
        <div class="chat-bubble chat-bubble--transfer">
          Transfer ${escapeHtml(formatMoney(item.amount))} ${direction === "out" ? `to ${escapeHtml(toName)}` : `from ${escapeHtml(fromName)}`}
          ${item.description ? ` &mdash; ${escapeHtml(item.description)}` : ""}
        </div>
      `;
      continue;
    }

    const isDebit = type === "debit";
    const bubbleClass = isDebit ? "chat-bubble--debit" : "chat-bubble--credit";
    const badgeClass = isDebit ? "chat-bubble__type-badge--debit" : "chat-bubble__type-badge--credit";
    const sign = isDebit ? "-" : "+";
    const typeLabel = isDebit ? "DEBIT" : "CREDIT";

    html += `
      <div class="chat-bubble ${bubbleClass}" data-id="${escapeHtml(item.id)}" data-searchtext="${escapeHtml((item.description || "").toLowerCase() + " " + (item.category || "").toLowerCase() + " " + item.amount)}">
        <span class="chat-bubble__amount">${sign}${escapeHtml(formatMoney(item.amount))}</span>
        <span class="chat-bubble__desc">${escapeHtml(item.description || item.category || "")}</span>
        <div class="chat-bubble__meta">
          <span class="chat-bubble__type-badge ${badgeClass}">${typeLabel}</span>
          <span>${escapeHtml(item.category || "")}</span>
          <span>${escapeHtml(new Date(item.occurredAt || item.dateKey).toLocaleTimeString(appSettings.locale, { hour: "2-digit", minute: "2-digit" }))}</span>
          ${balanceStr ? `<span class="chat-bubble__balance">Bal: ${escapeHtml(balanceStr)}</span>` : ""}
        </div>
      </div>
    `;
  }

  el.accountActivityList.innerHTML = html;
  el.accountActivityList.scrollTop = el.accountActivityList.scrollHeight;
}

function updateChatTypeIndicator() {
  const badge = document.querySelector("#chatTypeBadge");
  if (!badge) return;
  if (chatForceType === "credit") {
    badge.textContent = "CREDIT";
    badge.className = "chat-type-badge chat-type-badge--credit";
  } else {
    badge.textContent = "DEBIT";
    badge.className = "chat-type-badge chat-type-badge--debit";
  }

  document.querySelectorAll(".chat-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.chatType === (chatForceType || "debit"));
  });
}


async function handleChatSend() {
  const chatInput = document.querySelector("#chatInput");
  if (!chatInput) return;
  const rawValue = chatInput.value.trim();
  if (!rawValue) return;

  const accountId = activityViewAccountId;
  if (!accountId) return;

  // Multi-line support: split by newlines, parse each line
  const lines = rawValue.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const transactions = [];
  const errors = [];

  for (const line of lines) {
    const parsed = parseExpense(line);
    if (!parsed.valid) { errors.push(line); continue; }

    let txType;
    if (chatForceType) {
      txType = chatForceType;
    } else {
      txType = parsed.type === "income" ? "credit" : "debit";
    }

    const now = new Date().toISOString();
    transactions.push({
      id: crypto.randomUUID(),
      type: txType,
      amount: parsed.amount,
      accountId,
      fromAccountId: txType === "debit" ? accountId : null,
      toAccountId: txType === "credit" ? accountId : null,
      category: parsed.category,
      description: parsed.description,
      dateKey: parsed.dateKey,
      occurredAt: parsed.occurredAt,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      syncStatus: "pending",
      lastSyncError: "",
    });
  }

  if (transactions.length === 0) {
    showToast(errors.length ? `Could not parse: "${errors[0]}"` : "Could not parse. Try: Lunch 150");
    return;
  }

  // Check balance for debits
  const totalDebit = transactions.filter((t) => t.type === "debit").reduce((s, t) => s + t.amount, 0);
  if (totalDebit > 0) {
    const currentBalance = getAccountBalance(accountId);
    if (totalDebit > currentBalance) {
      const ok = await showConfirm("Insufficient Balance", `Total debit: ${formatMoney(totalDebit)}. Current: ${formatMoney(currentBalance)}. Continue?`);
      if (!ok) return;
    }
  }

  // Save all transactions
  for (const tx of transactions) {
    await putExpense(tx);
    logAudit("expense", tx.id, "create", null, tx);
  }

  chatInput.value = "";
  chatInput.style.height = "auto";
  chatForceType = null;
  updateChatTypeIndicator();
  hideChatPreview();

  await refreshUI();
  renderAccountActivity(accountId);

  const balance = getAccountBalance(accountId);
  el.accountActivityBalance.textContent = formatMoney(balance);

  // Haptic feedback
  if (navigator.vibrate) navigator.vibrate(10);

  // Undo toast
  const totalAmount = transactions.reduce((s, t) => s + t.amount, 0);
  const msg = transactions.length > 1
    ? `${transactions.length} entries added • Total: ${formatMoney(totalAmount)}`
    : `${transactions[0].type === "credit" ? "Credit" : "Debit"}: ${formatMoney(transactions[0].amount)}`;
  showUndoToast(msg, transactions);

  if (errors.length) {
    setTimeout(() => showToast(`${errors.length} line(s) could not be parsed`), 500);
  }

  trackEvent("transaction_added", { count: transactions.length, totalAmount, method: "chat" });
  syncPendingRecords();
}

function showUndoToast(message, transactions) {
  const toast = el.toast;
  if (!toast) { showToast(message); return; }

  if (undoTimeout) clearTimeout(undoTimeout);
  clearTimeout(showToast.timer);
  undoTransactions = transactions;

  toast.className = "toast toast--undo";
  toast.classList.remove("hidden");
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button type="button" class="toast__undo-btn" id="undoBtn">UNDO</button>
    <div class="toast__undo-timer"><div class="toast__undo-timer-fill"></div></div>
  `;

  const undoBtn = toast.querySelector("#undoBtn");
  if (undoBtn) {
    undoBtn.addEventListener("click", async () => {
      clearTimeout(undoTimeout);
      for (const tx of undoTransactions) {
        await putExpense({ ...tx, deleted: true, updatedAt: new Date().toISOString(), syncStatus: "pending" });
        logAudit("expense", tx.id, "delete", tx, null);
      }
      undoTransactions = [];
      toast.classList.add("hidden");
      await refreshUI();
      if (activityViewAccountId) {
        renderAccountActivity(activityViewAccountId);
        const bal = getAccountBalance(activityViewAccountId);
        el.accountActivityBalance.textContent = formatMoney(bal);
      }
      showToast("Undone!");
    }, { once: true });
  }

  undoTimeout = setTimeout(() => {
    undoTransactions = [];
    toast.classList.add("hidden");
    toast.innerHTML = "";
  }, 4000);
}

function hideChatPreview() {
  const preview = document.querySelector("#chatParsePreview");
  if (preview) { preview.classList.add("hidden"); preview.innerHTML = ""; }
}

function updateChatParsePreview(value) {
  const preview = document.querySelector("#chatParsePreview");
  if (!preview) return;

  const rawValue = value.trim();
  if (!rawValue) { preview.classList.add("hidden"); preview.innerHTML = ""; return; }

  const lines = rawValue.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const results = lines.map((line) => parseExpense(line)).filter((r) => r.valid);

  if (results.length === 0) { preview.classList.add("hidden"); preview.innerHTML = ""; return; }

  preview.classList.remove("hidden");

  if (results.length === 1) {
    const r = results[0];
    const txType = chatForceType || (r.type === "income" ? "credit" : "debit");
    const amountClass = txType === "credit" ? "chat-parse-preview__amount--credit" : "";
    preview.innerHTML = `
      <span class="chat-parse-preview__item chat-parse-preview__amount ${amountClass}">${txType === "credit" ? "+" : "-"}${escapeHtml(formatMoney(r.amount))}</span>
      <span class="chat-parse-preview__item chat-parse-preview__category">${escapeHtml(r.category)}</span>
      <span class="chat-parse-preview__item">${txType.toUpperCase()}</span>
    `;
  } else {
    const total = results.reduce((s, r) => s + r.amount, 0);
    preview.innerHTML = `
      <span class="chat-parse-preview__item chat-parse-preview__count">${results.length} entries</span>
      <span class="chat-parse-preview__item chat-parse-preview__amount">Total: ${escapeHtml(formatMoney(total))}</span>
    `;
  }
}

// ── Budget Modal ────────────────────────────────────────────────────────────
function openBudgetModal() {
  if (!el.budgetModal) return;
  el.budgetCategory.value = "Food";
  el.budgetAmount.value = "";
  showMessage(el.budgetModalMessage, "");
  openModal(el.budgetModal);
  el.budgetAmount.focus();
}

async function saveBudget() {
  const category = el.budgetCategory.value;
  const amount = Number(el.budgetAmount.value);
  const amountField = el.budgetAmount.closest(".form-field");
  const amountErr = document.getElementById("budgetAmountError");
  clearFieldError(amountField, amountErr);
  showMessage(el.budgetModalMessage, "");
  if (!amount || amount <= 0) { setFieldError(amountField, amountErr, "Enter a valid budget amount."); return; }

  const existing = cachedBudgets.find((b) => b.category === category);
  const budget = {
    id: existing ? existing.id : crypto.randomUUID(),
    category,
    amount,
    monthKey: "all",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await putBudget(budget);
  logAudit("budget", budget.id, existing ? "update" : "create", existing, budget);
  closeModal(el.budgetModal);
  await refreshUI();
  showToast(`Budget set: ${formatMoney(amount)}/month for ${category}.`);
}

async function handleDeleteBudget(budgetId) {
  const confirmed = await showConfirm("Remove Budget", "Remove this budget limit?");
  if (!confirmed) return;
  const existing = cachedBudgets.find((b) => b.id === budgetId);
  await deleteBudget(budgetId);
  logAudit("budget", budgetId, "delete", existing, null);
  await refreshUI();
  showToast("Budget removed.");
}

// ── Export / Import ─────────────────────────────────────────────────────────
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

function exportCsv() {
  const accountMap = new Map(cachedAccounts.map((a) => [a.id, a.name]));
  const rows = [
    ["Date", "Type", "Amount", "Category", "Description", "Account", "From Account", "To Account", "Sync Status"],
    ...getVisibleExpenses().map((item) => [
      item.dateKey, item.type, item.amount, item.category || "", item.description || "",
      item.accountId ? accountMap.get(item.accountId) || item.accountId : "",
      item.fromAccountId ? accountMap.get(item.fromAccountId) || item.fromAccountId : "",
      item.toAccountId ? accountMap.get(item.toAccountId) || item.toAccountId : "",
      item.syncStatus,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadFile(`expenses-${localDateKey()}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
}

function exportJson() {
  const backup = { exportedAt: new Date().toISOString(), version: 3, accounts: cachedAccounts, transactions: cachedExpenses, budgets: cachedBudgets, recurring: cachedRecurring };
  downloadFile(`expenses-backup-${localDateKey()}.json`, JSON.stringify(backup, null, 2), "application/json");
}

function validateTransaction(item) {
  if (!item || typeof item !== "object") return false;
  if (typeof item.amount !== "number" && typeof item.amount !== "string") return false;
  const amt = Number(item.amount);
  if (isNaN(amt) || amt < 0 || amt > 100000000) return false;
  if (!item.type || !["debit", "credit", "transfer", "adjustment", "income", "expense"].includes(String(item.type))) return false;
  if (!item.dateKey || !/^\d{4}-\d{2}-\d{2}/.test(String(item.dateKey))) return false;
  return true;
}

function validateAccount(item) {
  if (!item || typeof item !== "object") return false;
  if (!item.name || typeof item.name !== "string") return false;
  if (item.openingBalance != null && isNaN(Number(item.openingBalance))) return false;
  return true;
}

async function importJson(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    let transactions, accounts;
    if (Array.isArray(data)) { transactions = data; accounts = []; }
    else { transactions = data.transactions || []; accounts = data.accounts || []; }

    const validTransactions = transactions.filter(validateTransaction);
    const validAccounts = accounts.filter(validateAccount);
    const skipped = transactions.length - validTransactions.length + accounts.length - validAccounts.length;

    const now = new Date().toISOString();
    const records = validTransactions.map((item) => ({ ...item, id: item.id || crypto.randomUUID(), updatedAt: item.updatedAt || now, createdAt: item.createdAt || now, syncStatus: "pending", lastSyncError: "" }));
    await bulkPutExpenses(records);
    for (const account of validAccounts) { await putAccount({ ...account, syncStatus: "pending", lastSyncError: "" }); }

    if (data.budgets && Array.isArray(data.budgets)) { for (const b of data.budgets) { if (b && b.category && b.amount) await putBudget(b); } }
    if (data.recurring && Array.isArray(data.recurring)) { for (const r of data.recurring) { if (r && r.id) await putRecurring(r); } }

    await refreshUI();
    const msg = skipped > 0 ? `${records.length} records restored (${skipped} invalid skipped).` : `${records.length} records restored.`;
    showToast(msg);
    syncPendingRecords();
  } catch (error) {
    showToast(error.message);
  } finally {
    el.importJsonInput.value = "";
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────
const emailError = document.querySelector("#emailError");
const passwordError = document.querySelector("#passwordError");
const passwordStrength = document.querySelector("#passwordStrength");
const strengthFill = document.querySelector("#strengthFill");
const strengthLabel = document.querySelector("#strengthLabel");
const signInLoader = document.querySelector("#signInLoader");
const createLoader = document.querySelector("#createLoader");

function validateEmail(email) {
  if (!email) return "Email address is required";
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) return "Enter a valid email address";
  return "";
}

function validatePassword(password, isCreate = false) {
  if (!password) return "Password is required";
  if (password.length < 6) return "Password must be at least 6 characters";
  if (isCreate && password.length < 8) return "Use 8+ characters for better security";
  return "";
}

function getPasswordStrength(password) {
  if (!password || password.length < 6) return { level: "weak", label: "Weak" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 2) return { level: "weak", label: "Weak" };
  if (score <= 3) return { level: "medium", label: "Fair" };
  return { level: "strong", label: "Strong" };
}

function showFieldError(errorEl, inputEl, message) {
  errorEl.textContent = message;
  errorEl.classList.toggle("visible", !!message);
  inputEl.classList.toggle("input-error", !!message);
  inputEl.classList.toggle("input-success", !message && inputEl.value.trim().length > 0);
}

function updatePasswordStrength(password) {
  if (!password) { passwordStrength.classList.add("hidden"); return; }
  passwordStrength.classList.remove("hidden");
  const { level, label } = getPasswordStrength(password);
  strengthFill.className = `strength-fill ${level}`;
  strengthLabel.className = `strength-label ${level}`;
  strengthLabel.textContent = label;
}

function setAuthLoading(button, loader, loading) {
  button.disabled = loading;
  button.classList.toggle("loading", loading);
  loader.classList.toggle("hidden", !loading);
}

function validateForm(isCreate = false) {
  const email = el.emailInput.value.trim();
  const password = el.passwordInput.value;
  const emailErr = validateEmail(email);
  const passwordErr = validatePassword(password, isCreate);
  showFieldError(emailError, el.emailInput, emailErr);
  showFieldError(passwordError, el.passwordInput, passwordErr);
  return !emailErr && !passwordErr;
}

function friendlyAuthError(code) {
  const map = {
    "auth/user-not-found": "No account found with this email",
    "auth/wrong-password": "Incorrect password",
    "auth/invalid-credential": "Invalid email or password",
    "auth/email-already-in-use": "An account with this email already exists",
    "auth/weak-password": "Password is too weak — use 6+ characters",
    "auth/too-many-requests": "Too many attempts. Please try again later",
    "auth/network-request-failed": "Network error — check your connection",
    "auth/invalid-email": "Invalid email format",
  };
  return map[code] || "Authentication failed. Please try again.";
}

async function handleSignIn() {
  if (!validateForm(false)) return;
  const email = el.emailInput.value.trim();
  const password = el.passwordInput.value;
  setAuthLoading(el.signInBtn, signInLoader, true);
  showMessage(el.authMessage, "");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showMessage(el.authMessage, friendlyAuthError(error.code), true);
  } finally {
    setAuthLoading(el.signInBtn, signInLoader, false);
  }
}

async function handleCreateAccount() {
  if (!validateForm(true)) return;
  const email = el.emailInput.value.trim();
  const password = el.passwordInput.value;
  setAuthLoading(el.createAccountBtn, createLoader, true);
  showMessage(el.authMessage, "");
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showMessage(el.authMessage, friendlyAuthError(error.code), true);
  } finally {
    setAuthLoading(el.createAccountBtn, createLoader, false);
  }
}

// Real-time field validation
el.emailInput.addEventListener("blur", () => {
  const err = validateEmail(el.emailInput.value.trim());
  showFieldError(emailError, el.emailInput, err);
});

el.passwordInput.addEventListener("input", () => {
  const password = el.passwordInput.value;
  updatePasswordStrength(password);
  if (passwordError.classList.contains("visible")) {
    const err = validatePassword(password);
    showFieldError(passwordError, el.passwordInput, err);
  }
});

el.passwordInput.addEventListener("blur", () => {
  const err = validatePassword(el.passwordInput.value);
  showFieldError(passwordError, el.passwordInput, err);
});

// ── Data Migration ──────────────────────────────────────────────────────────
async function migrateExistingData() {
  const allTx = await getAllExpenses();
  const allAccounts = await getAllAccounts();
  const needsMigration = allTx.filter((t) => {
    if (t.deleted) return false;
    const type = normalizeType(t.type);
    if (type === "adjustment" || type === "transfer") return false;
    if (t.accountId || t.fromAccountId || t.toAccountId) return false;
    return true;
  });
  if (!needsMigration.length) return;

  const purseAccount = allAccounts.find((a) => a.name.toLowerCase().includes("purse") || (a.type === "cash" && !a.archived));
  const bankAccount = allAccounts.find((a) => a.name.toLowerCase().includes("bank") || (a.type === "bank" && !a.archived));
  if (!purseAccount && !bankAccount) return;

  const now = new Date().toISOString();
  let migrated = 0;
  for (const tx of needsMigration) {
    const desc = (tx.description || "").toLowerCase();
    const payment = (tx.paymentMethod || "").toLowerCase();
    let targetAccountId = null;
    if (payment.includes("cash") || desc.includes("purse")) targetAccountId = purseAccount?.id || null;
    else if (payment.includes("upi") || payment.includes("card") || payment.includes("bank")) targetAccountId = bankAccount?.id || null;
    else if (purseAccount && !bankAccount) targetAccountId = purseAccount.id;
    else if (bankAccount && !purseAccount) targetAccountId = bankAccount.id;
    if (!targetAccountId) continue;

    const type = normalizeType(tx.type);
    await putExpense({ ...tx, type, accountId: targetAccountId, fromAccountId: type === "debit" ? targetAccountId : null, toAccountId: type === "credit" ? targetAccountId : null, updatedAt: now, syncStatus: "pending", lastSyncError: "" });
    migrated++;
  }
  if (migrated > 0) showToast(`${migrated} transactions linked to accounts.`);
}

// ── Onboarding ──────────────────────────────────────────────────────────────
async function checkOnboarding() {
  const dismissed = await getSetting("onboardingDone");
  if (dismissed) return;
  if (cachedAccounts.length > 0) { await putSetting("onboardingDone", true); return; }
  el.onboardingOverlay.classList.remove("hidden");
}

function showOnboardingStep(step) {
  const steps = el.onboardingOverlay.querySelectorAll("[data-step]");
  steps.forEach((s) => s.classList.toggle("hidden", s.dataset.step !== String(step)));
  const dots = el.onboardingOverlay.querySelectorAll(".onboarding-dot");
  dots.forEach((d) => d.classList.toggle("onboarding-dot--active", d.dataset.dot === String(step)));
}

function dismissOnboarding() {
  el.onboardingOverlay.classList.add("hidden");
  putSetting("onboardingDone", true);
}

async function onboardingCreateAccount() {
  const nameInput = document.querySelector("#onboardingAccountName");
  const typeInput = document.querySelector("#onboardingAccountType");
  const balanceInput = document.querySelector("#onboardingBalance");
  const name = nameInput ? nameInput.value.trim() : "";
  if (!name) { showToast("Please enter an account name."); return; }

  const now = new Date().toISOString();
  await putAccount({
    id: crypto.randomUUID(), name, type: typeInput ? typeInput.value : "cash",
    openingBalance: Number(balanceInput?.value || 0), openingDate: localDateKey(),
    alias: "", archived: false, createdAt: now, updatedAt: now, syncStatus: "pending", lastSyncError: "",
  });
  await refreshUI();
  showOnboardingStep(3);
  syncPendingRecords();
}

// ── Activity Log Rendering ──────────────────────────────────────────────────
let auditLogOffset = 0;
const AUDIT_PAGE_SIZE = 50;

async function renderAuditLog(append = false) {
  const container = document.querySelector("#auditLogContainer");
  const loadMoreBtn = document.querySelector("#loadMoreAuditBtn");
  if (!container) return;

  if (!append) auditLogOffset = 0;

  const entries = await getAuditLog(AUDIT_PAGE_SIZE, auditLogOffset);
  const totalCount = await getAuditLogCount();

  if (!entries.length && !append) {
    container.innerHTML = '<p class="empty-state" style="padding:0.75rem;margin:0;font-size:0.8rem;">No activity recorded yet.</p>';
    if (loadMoreBtn) loadMoreBtn.classList.add("hidden");
    return;
  }

  const actionIcons = { create: "+", update: "~", delete: "×" };

  const html = entries.map((entry) => `
    <div class="audit-log__item">
      <div class="audit-log__icon audit-log__icon--${escapeHtml(entry.action)}">
        ${actionIcons[entry.action] || "?"}
      </div>
      <div class="audit-log__body">
        <div class="audit-log__text">${escapeHtml(formatAuditEntry(entry))}</div>
        <div class="audit-log__time">${escapeHtml(relativeTime(entry.timestamp))}</div>
      </div>
    </div>
  `).join("");

  if (append) {
    container.insertAdjacentHTML("beforeend", html);
  } else {
    container.innerHTML = html;
  }

  auditLogOffset += entries.length;
  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle("hidden", auditLogOffset >= totalCount);
  }
}

// ── Settings Panel ──────────────────────────────────────────────────────────
function openSettings() { el.settingsPanel.classList.remove("hidden"); el.settingsPanel.classList.add("open"); renderAuditLog(); }
function closeSettings() { el.settingsPanel.classList.remove("open"); setTimeout(() => el.settingsPanel.classList.add("hidden"), 300); }

// ── Filter Sheet (mobile) ───────────────────────────────────────────────────
function openFilterSheet() { el.filterSheet.classList.remove("hidden"); el.filterSheet.classList.add("open"); document.body.classList.add("modal-open"); }
function closeFilterSheet() { el.filterSheet.classList.remove("open"); document.body.classList.remove("modal-open"); setTimeout(() => el.filterSheet.classList.add("hidden"), 300); }

function applyMobileFilters() {
  const mobileSearch = document.querySelector("#mobileSearchInput");
  const mobileType = document.querySelector("#mobileTypeFilter");
  const mobileAccount = document.querySelector("#mobileAccountFilter");
  const mobileStart = document.querySelector("#mobileDateStart");
  const mobileEnd = document.querySelector("#mobileDateEnd");
  const mobileMin = document.querySelector("#mobileAmountMin");
  const mobileMax = document.querySelector("#mobileAmountMax");

  if (el.searchInput && mobileSearch) el.searchInput.value = mobileSearch.value;
  if (el.typeFilter && mobileType) el.typeFilter.value = mobileType.value;
  if (el.accountFilter && mobileAccount) el.accountFilter.value = mobileAccount.value;
  if (el.dateRangeStart && mobileStart) el.dateRangeStart.value = mobileStart.value;
  if (el.dateRangeEnd && mobileEnd) el.dateRangeEnd.value = mobileEnd.value;
  if (el.amountMin && mobileMin) el.amountMin.value = mobileMin.value;
  if (el.amountMax && mobileMax) el.amountMax.value = mobileMax.value;

  renderHistory();
  closeFilterSheet();
}

// ── Event Listeners ─────────────────────────────────────────────────────────

// PWA Install
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; el.installBtn.classList.remove("hidden"); });
window.addEventListener("appinstalled", () => { installPrompt = null; showToast("App installed."); });

// Re-lock on visibility change with grace period (user switches away and comes back)
let lastUnlockTime = 0;
let appLockEnabledCache = false;
const LOCK_GRACE_PERIOD_MS = 30000;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") return;
  if (!currentUser) return;
  if (!appLockEnabledCache) return;
  const elapsed = Date.now() - lastUnlockTime;
  if (elapsed < LOCK_GRACE_PERIOD_MS) return;
  const ls = document.querySelector("#lockScreen");
  if (ls && ls.classList.contains("hidden")) {
    ls.classList.remove("hidden");
    attemptUnlock();
  }
});

// Network
window.addEventListener("online", () => { setNetworkBadge(); showToast("Online. Syncing..."); syncPendingRecords(); });
window.addEventListener("offline", () => { setNetworkBadge(); showToast("Offline. Data saved locally."); });

// Install button
el.installBtn.addEventListener("click", async () => {
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
  showToast("Use browser menu to install.");
});

// Auth
const authForm = document.querySelector("#authForm");
if (authForm) authForm.addEventListener("submit", (e) => { e.preventDefault(); handleSignIn(); });
el.createAccountBtn.addEventListener("click", (e) => { e.preventDefault(); handleCreateAccount(); });
el.logoutBtn.addEventListener("click", () => signOut(auth));

// Password toggle
document.querySelector("#togglePasswordBtn").addEventListener("click", () => {
  const input = el.passwordInput;
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  document.querySelector("#eyeIcon").style.display = isHidden ? "none" : "";
  document.querySelector("#eyeOffIcon").style.display = isHidden ? "" : "none";
});

// Dark mode
el.darkModeToggle.addEventListener("click", toggleDarkMode);
const darkModeSetting = document.querySelector("#darkModeSettingToggle");
if (darkModeSetting) darkModeSetting.addEventListener("change", toggleDarkMode);

// App Lock
const appLockToggle = document.querySelector("#appLockToggle");
if (appLockToggle) {
  isAppLockEnabled().then((enabled) => { appLockToggle.checked = enabled; appLockEnabledCache = enabled; });
  isWebAuthnAvailable().then((available) => {
    if (!available) {
      appLockToggle.disabled = true;
      const desc = appLockToggle.closest(".settings-item")?.querySelector(".settings-item__desc");
      if (desc) desc.textContent = "Biometrics not available on this device";
    }
  });
  appLockToggle.addEventListener("change", async () => {
    try {
      if (appLockToggle.checked) {
        await enableAppLock();
        appLockEnabledCache = true;
        showToast("App lock enabled. You'll need biometrics to open the app.");
      } else {
        const verified = await verifyWithBiometrics();
        if (!verified) { appLockToggle.checked = true; return; }
        await disableAppLock();
        appLockEnabledCache = false;
        showToast("App lock disabled.");
      }
    } catch (err) {
      appLockToggle.checked = !appLockToggle.checked;
      showToast(err.message || "Failed to set up app lock.");
    }
  });
}

// Lock screen unlock button
const unlockBtn = document.querySelector("#unlockBtn");
const lockScreen = document.querySelector("#lockScreen");
const lockMessage = document.querySelector("#lockMessage");
const lockSignOutBtn = document.querySelector("#lockSignOutBtn");
let biometricFailCount = 0;

async function attemptUnlock() {
  if (lockMessage) lockMessage.textContent = "";
  try {
    const success = await verifyWithBiometrics();
    if (success) {
      lockScreen.classList.add("hidden");
      lastUnlockTime = Date.now();
      biometricFailCount = 0;
      if (lockSignOutBtn) lockSignOutBtn.classList.add("hidden");
    }
  } catch (err) {
    biometricFailCount++;
    if (biometricFailCount >= 3 && lockSignOutBtn) {
      lockSignOutBtn.classList.remove("hidden");
    }
    if (lockMessage) {
      if (biometricFailCount >= 3) {
        lockMessage.textContent = "Multiple failures. Sign out to regain access.";
      } else {
        lockMessage.textContent = err.name === "NotAllowedError"
          ? "Authentication cancelled. Tap to try again."
          : "Authentication failed. Tap to try again.";
      }
    }
  }
}

if (unlockBtn) unlockBtn.addEventListener("click", attemptUnlock);
if (lockSignOutBtn) lockSignOutBtn.addEventListener("click", async () => {
  const confirmed = await showConfirm("Sign Out", "This will sign you out. You'll need your email and password to sign back in.");
  if (confirmed) {
    lockScreen.classList.add("hidden");
    await disableAppLock();
    appLockEnabledCache = false;
    signOut(auth);
  }
});

// Tab navigation
for (const tab of tabs) {
  tab.btn.addEventListener("click", () => switchTab(tab.key));
}

// Arrow key navigation for tabs (WAI-ARIA pattern)
const tabList = document.querySelector('[role="tablist"]');
if (tabList) {
  tabList.addEventListener("keydown", (e) => {
    const tabBtns = tabs.map((t) => t.btn);
    const idx = tabBtns.indexOf(e.target);
    if (idx === -1) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % tabBtns.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + tabBtns.length) % tabBtns.length;
    if (next >= 0) {
      e.preventDefault();
      tabBtns[next].focus();
      switchTab(tabs[next].key);
    }
  });
}

// FAB
if (el.fabBtn) el.fabBtn.addEventListener("click", () => switchTab("add"));

// Settings
el.settingsBtn.addEventListener("click", openSettings);
document.querySelectorAll('[data-action="close-settings"]').forEach((btn) => btn.addEventListener("click", closeSettings));

// Audit log "Load more" button
const loadMoreAuditBtn = document.querySelector("#loadMoreAuditBtn");
if (loadMoreAuditBtn) loadMoreAuditBtn.addEventListener("click", () => renderAuditLog(true));

// Default account setting
const defaultAccountSelect = document.querySelector("#defaultAccountSelect");
if (defaultAccountSelect) {
  defaultAccountSelect.addEventListener("change", async () => {
    const val = defaultAccountSelect.value;
    defaultAccountId = val || null;
    await putSetting("defaultAccountId", val || null);
    populateAccountDropdowns();
    showToast(val ? `Default account set to ${defaultAccountSelect.selectedOptions[0].textContent}` : "Default account cleared.");
  });
}

// Display name setting
const saveNameBtn = document.querySelector("#saveNameBtn");
const displayNameInput = document.querySelector("#displayNameInput");
if (saveNameBtn && displayNameInput) {
  displayNameInput.addEventListener("input", () => { displayNameInput.dataset.touched = "1"; });
  displayNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveUserName(displayNameInput.value); } });
  saveNameBtn.addEventListener("click", () => saveUserName(displayNameInput.value));
}

// Transaction form
if (el.transactionForm) el.transactionForm.addEventListener("submit", handleTransactionSubmit);
if (el.txAmount) el.txAmount.addEventListener("input", () => {
  if (Number(el.txAmount.value) > 0) clearFieldError(document.getElementById("txAmountGroup"), document.getElementById("txAmountError"));
});
if (el.txDescription) el.txDescription.addEventListener("input", () => {
  if (el.txDescription.value.trim()) clearFieldError(document.getElementById("txDescriptionField"), document.getElementById("txDescriptionError"));
});
if (el.txAccount) el.txAccount.addEventListener("change", () => {
  if (el.txAccount.value) clearFieldError(document.getElementById("txSingleAccountGroup"), document.getElementById("txAccountError"));
});
if (el.txFromAccount) el.txFromAccount.addEventListener("change", () => {
  if (el.txFromAccount.value) clearFieldError(document.getElementById("txFromAccountField"), document.getElementById("txFromAccountError"));
});
if (el.txToAccount) el.txToAccount.addEventListener("change", () => {
  if (el.txToAccount.value) clearFieldError(document.getElementById("txToAccountField"), document.getElementById("txToAccountError"));
});
if (el.accountNameInput) el.accountNameInput.addEventListener("input", () => {
  if (el.accountNameInput.value.trim()) clearFieldError(el.accountNameInput.closest(".form-field"), document.getElementById("accountNameError"));
});
if (el.budgetAmount) el.budgetAmount.addEventListener("input", () => {
  if (Number(el.budgetAmount.value) > 0) clearFieldError(el.budgetAmount.closest(".form-field"), document.getElementById("budgetAmountError"));
});
if (el.txTypeDebit) el.txTypeDebit.addEventListener("click", () => setTxType("debit"));
if (el.txTypeCredit) el.txTypeCredit.addEventListener("click", () => setTxType("credit"));
if (el.txTypeTransfer) el.txTypeTransfer.addEventListener("click", () => setTxType("transfer"));
if (el.txDescription) {
  el.txDescription.addEventListener("input", () => {
    if (el.txCategory && getSelectedTxType() !== "transfer") {
      el.txCategory.value = suggestCategory(el.txDescription.value);
    }
  });
}

// Quick-add
const quickAddSubmit = document.querySelector('[data-action="quick-add-submit"]');
if (quickAddSubmit) quickAddSubmit.addEventListener("click", handleQuickAdd);
if (el.quickAddInput) {
  el.quickAddInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleQuickAdd(); });
  el.quickAddInput.addEventListener("input", () => {
    const preview = document.querySelector("#quickAddPreview");
    const text = el.quickAddInput.value.trim();
    if (!text || text.length < 3) { preview.classList.add("hidden"); return; }
    const parsed = parseExpense(text);
    if (parsed.valid) {
      preview.classList.remove("hidden");
      preview.innerHTML = `<strong>${escapeHtml(parsed.description)}</strong> &mdash; ${escapeHtml(formatMoney(parsed.amount))} &bull; ${escapeHtml(parsed.category)} &bull; ${escapeHtml(parsed.type === "income" ? "Income" : "Expense")}`;
    } else {
      preview.classList.add("hidden");
    }
  });
}

// Quick-add chips
document.querySelectorAll(".quick-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    el.quickAddInput.value = chip.dataset.quicktext;
    el.quickAddInput.focus();
    el.quickAddInput.dispatchEvent(new Event("input"));
  });
});

// ── Receipt Scanner ──────────────────────────────────────────────────────────
const scanReceiptBtn = document.querySelector("#scanReceiptBtn");
const uploadReceiptBtn = document.querySelector("#uploadReceiptBtn");
const receiptCameraInput = document.querySelector("#receiptCameraInput");
const receiptFileInput = document.querySelector("#receiptFileInput");
const scanProgress = document.querySelector("#scanProgress");
const scanResult = document.querySelector("#scanResult");
const scanSaveBtn = document.querySelector("#scanSaveBtn");
const scanDiscardBtn = document.querySelector("#scanDiscardBtn");

if (scanReceiptBtn) scanReceiptBtn.addEventListener("click", () => receiptCameraInput.click());
if (uploadReceiptBtn) uploadReceiptBtn.addEventListener("click", () => receiptFileInput.click());

async function handleReceiptFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    showToast("Please select a valid image file.");
    return;
  }

  scanProgress.classList.remove("hidden");
  scanResult.classList.add("hidden");
  const progressFill = document.querySelector("#scanProgressFill");
  const progressLabel = document.querySelector("#scanProgressLabel");
  if (progressFill) progressFill.style.width = "5%";
  if (progressLabel) progressLabel.textContent = "Loading OCR engine...";

  try {
    const receiptModule = await import("./receipt-scanner.js");
    const result = await receiptModule.scanReceipt(file);

    clearTimeout(handleReceiptFile.workerTimer);
    handleReceiptFile.workerTimer = setTimeout(() => receiptModule.terminateWorker(), 60000);

    scanProgress.classList.add("hidden");

    if (!result.valid) {
      showToast("Could not extract amount from receipt. Try entering manually.");
      return;
    }

    // Populate result fields
    document.querySelector("#scanAmount").value = result.amount || "";
    document.querySelector("#scanMerchant").value = result.description || "";
    document.querySelector("#scanCategory").value = result.category || "Other";
    document.querySelector("#scanDate").value = result.dateKey || localDateKey();
    document.querySelector("#scanRawText").textContent = result.rawText || "";

    // Populate account dropdown
    const scanAccountSelect = document.querySelector("#scanAccount");
    if (scanAccountSelect) {
      const activeAccounts = cachedAccounts.filter((a) => !a.archived);
      scanAccountSelect.innerHTML = '<option value="">Select account</option>';
      for (const a of activeAccounts) {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        scanAccountSelect.appendChild(opt);
      }
      if (defaultAccountId) scanAccountSelect.value = defaultAccountId;
      else if (activeAccounts.length === 1) scanAccountSelect.value = activeAccounts[0].id;
    }

    // Confidence badge
    const confidenceBadge = document.querySelector("#scanConfidence");
    if (confidenceBadge) {
      if (result.confidence >= 70) {
        confidenceBadge.textContent = "High confidence";
        confidenceBadge.classList.remove("low");
      } else {
        confidenceBadge.textContent = "Please verify";
        confidenceBadge.classList.add("low");
      }
    }

    scanResult.classList.remove("hidden");
  } catch (err) {
    scanProgress.classList.add("hidden");
    showToast("Receipt scan failed: " + (err.message || "Unknown error"));
  }
}

if (receiptCameraInput) receiptCameraInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleReceiptFile(file);
  receiptCameraInput.value = "";
});

if (receiptFileInput) receiptFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleReceiptFile(file);
  receiptFileInput.value = "";
});

if (scanSaveBtn) scanSaveBtn.addEventListener("click", async () => {
  const amount = Number(document.querySelector("#scanAmount").value);
  const description = document.querySelector("#scanMerchant").value.trim();
  const category = document.querySelector("#scanCategory").value;
  const dateKey = document.querySelector("#scanDate").value || localDateKey();
  const accountId = document.querySelector("#scanAccount").value;

  if (!amount || amount <= 0) { showToast("Please enter a valid amount."); return; }
  if (!accountId) { showToast("Please select an account."); return; }

  const now = new Date().toISOString();
  const transaction = {
    id: crypto.randomUUID(),
    type: "debit",
    amount,
    accountId,
    fromAccountId: accountId,
    toAccountId: null,
    category: category || "Other",
    description: description || "Receipt scan",
    dateKey,
    occurredAt: `${dateKey}T${new Date().toISOString().slice(11, 23)}Z`,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    syncStatus: "pending",
    lastSyncError: "",
  };

  await putExpense(transaction);
  logAudit("expense", transaction.id, "create", null, transaction);
  scanResult.classList.add("hidden");
  await refreshUI();
  showToast(`Saved: ${formatMoney(amount)} — ${description || category}`);
  syncPendingRecords();
});

if (scanDiscardBtn) scanDiscardBtn.addEventListener("click", () => {
  scanResult.classList.add("hidden");
});

// History filters
function resetAndRenderHistory() { historyDisplayCount = historyPageSize; renderHistory(); }
if (el.searchInput) el.searchInput.addEventListener("input", debounce(resetAndRenderHistory, 250));
if (el.typeFilter) el.typeFilter.addEventListener("change", resetAndRenderHistory);
if (el.accountFilter) el.accountFilter.addEventListener("change", resetAndRenderHistory);
if (el.dateRangeStart) el.dateRangeStart.addEventListener("change", resetAndRenderHistory);
if (el.dateRangeEnd) el.dateRangeEnd.addEventListener("change", resetAndRenderHistory);
if (el.amountMin) el.amountMin.addEventListener("change", resetAndRenderHistory);
if (el.amountMax) el.amountMax.addEventListener("change", resetAndRenderHistory);

// Filter sheet (mobile)
if (el.filterSheetBtn) el.filterSheetBtn.addEventListener("click", openFilterSheet);
document.querySelectorAll('[data-action="close-filter-sheet"]').forEach((btn) => btn.addEventListener("click", closeFilterSheet));
document.querySelectorAll('[data-action="apply-filters"]').forEach((btn) => btn.addEventListener("click", applyMobileFilters));
document.querySelectorAll('[data-action="clear-filters"]').forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("#filterSheet input, #filterSheet select").forEach((input) => { if (input.type === "search" || input.type === "text" || input.type === "number" || input.type === "date") input.value = ""; else if (input.tagName === "SELECT") input.selectedIndex = 0; });
  if (el.searchInput) el.searchInput.value = "";
  if (el.typeFilter) el.typeFilter.value = "all";
  if (el.accountFilter) el.accountFilter.value = "all";
  if (el.dateRangeStart) el.dateRangeStart.value = "";
  if (el.dateRangeEnd) el.dateRangeEnd.value = "";
  if (el.amountMin) el.amountMin.value = "";
  if (el.amountMax) el.amountMax.value = "";
  resetAndRenderHistory();
  closeFilterSheet();
}));

// View all history from dashboard
document.querySelectorAll('[data-action="view-all-history"]').forEach((btn) => btn.addEventListener("click", () => switchTab("history")));

// Export/Import
if (el.exportCsvBtn) el.exportCsvBtn.addEventListener("click", exportCsv);
if (el.exportJsonBtn) el.exportJsonBtn.addEventListener("click", exportJson);
if (el.syncNowBtn) el.syncNowBtn.addEventListener("click", async () => { await syncPendingRecords(); showToast(navigator.onLine ? "Sync completed." : "Still offline."); });
if (el.importJsonInput) el.importJsonInput.addEventListener("change", (event) => { const [file] = event.target.files; if (file) importJson(file); });

// History item actions (edit/delete + load more)
if (el.historyList) el.historyList.addEventListener("click", (event) => {
  const loadMore = event.target.closest("#historyLoadMoreBtn");
  if (loadMore) { historyDisplayCount += historyPageSize; renderHistory(); return; }
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = button.closest(".history-item");
  const id = item?.dataset.id;
  if (!id) return;
  if (button.dataset.action === "edit") editExpense(id);
  if (button.dataset.action === "delete") deleteExpense(id);
});

// Recent transactions actions
if (el.recentTransactions) el.recentTransactions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = button.closest(".history-item");
  const id = item?.dataset.id;
  if (!id) return;
  if (button.dataset.action === "edit") editExpense(id);
  if (button.dataset.action === "delete") deleteExpense(id);
});

// Recurring transactions actions
const recurringList = document.querySelector("#recurringList");
if (recurringList) {
  recurringList.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const item = btn.closest(".recurring-item");
    const id = item?.dataset.recurringId;
    if (!id) return;
    const action = btn.dataset.action;

    const recurring = cachedRecurring.find((r) => r.id === id);
    if (!recurring) return;

    if (action === "pause-recurring") {
      recurring.paused = true;
      await putRecurring(recurring);
      showToast("Recurring paused.");
    } else if (action === "resume-recurring") {
      recurring.paused = false;
      await putRecurring(recurring);
      showToast("Recurring resumed.");
    } else if (action === "delete-recurring") {
      const ok = await showConfirm("Delete Recurring", `Delete "${recurring.description || recurring.category}" recurring transaction?`);
      if (!ok) return;
      recurring.deleted = true;
      await putRecurring(recurring);
      showToast("Recurring deleted.");
    }

    cachedRecurring = await getAllRecurring();
    renderRecurring();
  });
}

// Account actions
if (el.accountsList) el.accountsList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  const card = event.target.closest(".account-card");
  const accountId = card?.dataset.accountId;
  if (!accountId) return;
  if (!button) { openAccountActivityModal(accountId); return; }
  const action = button.dataset.action;
  if (action === "view-activity") openAccountActivityModal(accountId);
  else if (action === "edit-account") openEditAccountModal(accountId);
  else if (action === "edit-balance") openEditBalanceModal(accountId);
});

el.addAccountBtn.addEventListener("click", openAddAccountModal);
el.saveAccountBtn.addEventListener("click", saveAccount);
el.editOpeningBalanceBtn.addEventListener("click", () => { closeModal(el.accountModal); if (editingAccountId) openEditOpeningBalanceModal(editingAccountId); });
el.saveBalanceBtn.addEventListener("click", saveBalanceAdjustment);
el.saveOpeningBalanceBtn.addEventListener("click", saveOpeningBalance);
el.createAdjustmentInsteadBtn.addEventListener("click", () => { const id = adjustmentTargetAccountId; closeModal(el.editOpeningBalanceModal); openEditBalanceModal(id); });
el.activityEditDetailsBtn.addEventListener("click", () => { closeModal(el.accountActivityModal); openEditAccountModal(activityViewAccountId); });
el.activityEditBalanceBtn.addEventListener("click", () => { closeModal(el.accountActivityModal); openEditBalanceModal(activityViewAccountId); });
document.getElementById("chatBackBtn").addEventListener("click", () => { closeModal(el.accountActivityModal); });

// Chat send button & input
const chatSendBtn = document.querySelector("#chatSendBtn");
const chatInput = document.querySelector("#chatInput");
if (chatSendBtn) chatSendBtn.addEventListener("click", handleChatSend);
if (chatInput) {
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
  });
  // Auto-resize textarea
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
    updateChatParsePreview(chatInput.value);
  });
}

// Chat type chips (Spent / Received)
document.querySelectorAll(".chat-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const type = chip.dataset.chatType;
    chatForceType = chatForceType === type ? null : type;
    if (!chatForceType) chatForceType = type === "credit" ? "credit" : "debit";
    updateChatTypeIndicator();
    const input = document.querySelector("#chatInput");
    if (input) input.focus();
  });
});

// Chat bubble click → show Edit/Delete actions
const accountActivityList = document.querySelector("#accountActivityList");
if (accountActivityList) {
  accountActivityList.addEventListener("click", (event) => {
    const actionBtn = event.target.closest(".chat-bubble-action-btn");
    if (actionBtn) {
      const bubble = actionBtn.closest(".chat-bubble");
      const id = bubble?.dataset.id;
      if (!id) return;
      if (actionBtn.dataset.action === "edit") {
        editExpense(id);
      } else if (actionBtn.dataset.action === "delete") {
        deleteExpense(id).then(() => {
          renderAccountActivity(activityViewAccountId);
          const balance = getAccountBalance(activityViewAccountId);
          el.accountActivityBalance.textContent = formatMoney(balance);
        });
      }
      return;
    }

    const bubble = event.target.closest(".chat-bubble[data-id]");
    if (!bubble) return;

    // Remove actions from all other bubbles
    accountActivityList.querySelectorAll(".chat-bubble-actions").forEach((el) => el.remove());
    accountActivityList.querySelectorAll(".chat-bubble--active").forEach((el) => el.classList.remove("chat-bubble--active"));

    // Add action buttons to this bubble
    bubble.classList.add("chat-bubble--active");
    const actions = document.createElement("div");
    actions.className = "chat-bubble-actions";
    actions.innerHTML = `
      <button type="button" class="chat-bubble-action-btn chat-bubble-action-btn--edit" data-action="edit">Edit</button>
      <button type="button" class="chat-bubble-action-btn chat-bubble-action-btn--delete" data-action="delete">Delete</button>
    `;
    bubble.appendChild(actions);
  });
}

// Chat Search
const chatSearchToggleBtn = document.querySelector("#chatSearchToggleBtn");
const chatSearchBar = document.querySelector("#chatSearchBar");
const chatSearchInput = document.querySelector("#chatSearchInput");
const chatSearchCloseBtn = document.querySelector("#chatSearchCloseBtn");

if (chatSearchToggleBtn) {
  chatSearchToggleBtn.addEventListener("click", () => {
    if (chatSearchBar) {
      chatSearchBar.classList.toggle("hidden");
      if (!chatSearchBar.classList.contains("hidden")) {
        chatSearchInput.value = "";
        chatSearchInput.focus();
        filterChatBubbles("");
      } else {
        filterChatBubbles("");
      }
    }
  });
}

if (chatSearchCloseBtn) {
  chatSearchCloseBtn.addEventListener("click", () => {
    if (chatSearchBar) chatSearchBar.classList.add("hidden");
    if (chatSearchInput) chatSearchInput.value = "";
    filterChatBubbles("");
  });
}

if (chatSearchInput) {
  chatSearchInput.addEventListener("input", debounce(() => {
    filterChatBubbles(chatSearchInput.value.trim().toLowerCase());
  }, 250));
}

function filterChatBubbles(query) {
  const list = document.querySelector("#accountActivityList");
  if (!list) return;
  const bubbles = list.querySelectorAll(".chat-bubble[data-searchtext]");
  const dividers = list.querySelectorAll(".chat-date-divider");

  if (!query) {
    bubbles.forEach((b) => { b.classList.remove("chat-bubble--hidden", "chat-bubble--highlight"); });
    dividers.forEach((d) => { d.classList.remove("hidden"); });
    return;
  }

  bubbles.forEach((b) => {
    const text = b.dataset.searchtext || "";
    if (text.includes(query)) {
      b.classList.remove("chat-bubble--hidden");
      b.classList.add("chat-bubble--highlight");
    } else {
      b.classList.add("chat-bubble--hidden");
      b.classList.remove("chat-bubble--highlight");
    }
  });

  dividers.forEach((d) => { d.classList.add("hidden"); });
}

// Edit transaction modal
const editTxSaveBtn = document.querySelector("#saveEditTxBtn");
if (editTxSaveBtn) editTxSaveBtn.addEventListener("click", saveEditedTransaction);

// Budget
if (el.addBudgetBtn) el.addBudgetBtn.addEventListener("click", openBudgetModal);
if (el.saveBudgetBtn) el.saveBudgetBtn.addEventListener("click", saveBudget);
if (el.budgetList) el.budgetList.addEventListener("click", (event) => {
  const btn = event.target.closest('[data-action="delete-budget"]');
  if (btn) handleDeleteBudget(btn.dataset.budgetId);
});

// Confirm modal
el.confirmYes.addEventListener("click", handleConfirmYes);
el.confirmNo.addEventListener("click", handleConfirmNo);

// Onboarding
document.querySelectorAll('[data-action="onboarding-next"]').forEach((btn) => btn.addEventListener("click", () => showOnboardingStep(2)));
document.querySelectorAll('[data-action="onboarding-skip"]').forEach((btn) => btn.addEventListener("click", dismissOnboarding));
document.querySelectorAll('[data-action="onboarding-create-account"]').forEach((btn) => btn.addEventListener("click", onboardingCreateAccount));
document.querySelectorAll('[data-action="onboarding-finish"]').forEach((btn) => btn.addEventListener("click", dismissOnboarding));

// Close modals only via close-button
document.addEventListener("click", (event) => {
  const closeBtn = event.target.closest("[data-modal].modal-close-btn");
  if (closeBtn) { const modal = document.querySelector(`#${closeBtn.dataset.modal}`); if (modal) closeModal(modal); }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (el.settingsPanel.classList.contains("open")) closeSettings();
  if (el.filterSheet.classList.contains("open")) closeFilterSheet();
});

// ── Back navigation for account activity screen on mobile ───────────────────
window.addEventListener("popstate", (event) => {
  if (!el.accountActivityModal.classList.contains("hidden")) {
    closingFromPopstate = true;
    closeModal(el.accountActivityModal);
    closingFromPopstate = false;
  }
});

// ── Initialization ──────────────────────────────────────────────────────────
async function checkStorageQuota() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (quota && usage / quota > 0.85) {
        showToast("Storage almost full. Consider exporting and clearing old data.");
      }
    } catch {}
  }
}

async function initialize() {
  initRippleEffect();
  initPageTransitions();
  initScrollHeader();
  initPullToRefresh(() => refreshUI());
  initSwipeNavigation(tabs, switchTab);
  initInsightsSubtabs();
  await initDarkMode();
  await loadDefaultAccount();
  await loadUserName();
  pruneOldAuditEntries();
  checkStorageQuota();
  setNetworkBadge();
  if (el.txDate) el.txDate.value = localDateKey();
  await restoreLastTab();
  await refreshUI();

  // Remove splash screen
  const splash = document.querySelector("#splashScreen");
  if (splash) splash.classList.add("hidden");

  if (!isFirebaseConfigured) {
    el.setupBanner.classList.remove("hidden");
    el.authScreen.classList.remove("hidden");
    el.signInBtn.disabled = true;
    el.createAccountBtn.disabled = true;
    showMessage(el.authMessage, "Complete Firebase configuration before signing in.", true);
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      el.authScreen.classList.add("hidden");
      el.appScreen.classList.remove("hidden");
      showMessage(el.authMessage, "");

      // Show lock screen if app lock is enabled
      const lockEnabled = await isAppLockEnabled();
      appLockEnabledCache = lockEnabled;
      if (lockEnabled) {
        const ls = document.querySelector("#lockScreen");
        if (ls) {
          ls.classList.remove("hidden");
          attemptUnlock();
        }
      }

      startCloudListener(user);
      await processRecurringTransactions();
      await migrateExistingData();
      await refreshUI();
      await checkOnboarding();
      syncPendingRecords();
    } else {
      if (cloudUnsubscribe) { cloudUnsubscribe(); cloudUnsubscribe = null; }
      el.appScreen.classList.add("hidden");
      el.authScreen.classList.remove("hidden");
      await refreshUI();
    }
  });
}

initialize().catch((error) => {
  console.error(error);
  showToast("Application startup failed. Check the console.");
});
