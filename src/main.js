import "./style.css";
import { registerSW } from "virtual:pwa-register";
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

function showToast(text) {
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
    el.confirmYes.focus();
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
    dashboardDate.textContent = new Date().toLocaleDateString(appSettings.locale, {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
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
function getAccountBalance(accountId) {
  const account = cachedAccounts.find((a) => a.id === accountId);
  return calculateAccountBalance(account, cachedExpenses);
}

function getTotalBalance() {
  return calculateTotalAvailableBalance(cachedAccounts, cachedExpenses);
}

function getVisibleExpenses() {
  return cachedExpenses
    .filter((expense) => !expense.deleted)
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
}

// ── Main Refresh ────────────────────────────────────────────────────────────
async function refreshUI() {
  [cachedExpenses, cachedAccounts, cachedBudgets, cachedRecurring] = await Promise.all([
    getAllExpenses(),
    getAllAccounts(),
    getAllBudgets(),
    getAllRecurring(),
  ]);
  renderSummary();
  renderBudgets();
  renderRecentTransactions();
  renderCategories();
  renderTrendChart();
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

  el.todayTotal.textContent = formatMoney(todayExpense);
  el.monthTotal.textContent = formatMoney(monthExpense);
  el.incomeTotal.textContent = formatMoney(monthIncome);
  if (el.totalAvailable) el.totalAvailable.textContent = formatMoney(getTotalBalance());
  if (el.avgDailySpend) el.avgDailySpend.textContent = formatMoney(avgDaily);
  if (el.savingsRate) el.savingsRate.textContent = `${savings}%`;
}

// ── Budget Rendering ────────────────────────────────────────────────────────
function renderBudgets() {
  if (!el.budgetList) return;
  if (!cachedBudgets.length) {
    el.budgetList.innerHTML = '<p class="budget-list__empty">No budgets set. Tap "+ Set Budget" to add one.</p>';
    return;
  }

  const month = currentMonthKey();
  const visible = getVisibleExpenses();

  el.budgetList.innerHTML = cachedBudgets.map((budget) => {
    const spent = visible
      .filter((item) => normalizeType(item.type) === "debit" && item.category === budget.category && String(item.dateKey).startsWith(month))
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const percent = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0;
    const statusClass = percent > 100 ? "budget-over" : percent >= 75 ? "budget-warning" : "";
    const barWidth = Math.min(percent, 100);
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

// ── Category Chart ──────────────────────────────────────────────────────────
function renderCategories() {
  if (!el.categoryChart) return;
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

  const maximum = sorted[0][1];
  el.categoryChart.innerHTML = sorted.map(([category, amount]) => {
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
}

// ── Monthly Trend Chart ─────────────────────────────────────────────────────
function renderTrendChart() {
  if (!el.trendChart) return;
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

  const maxAmount = Math.max(...sorted.map(([, v]) => v));
  el.trendChart.innerHTML = `
    <div class="trend-chart__bars">
      ${sorted.map(([monthKey, amount]) => {
        const height = maxAmount > 0 ? Math.max(5, Math.round((amount / maxAmount) * 100)) : 0;
        const label = new Date(monthKey + "-01").toLocaleDateString(appSettings.locale, { month: "short" });
        return `
          <div class="trend-chart__col">
            <div class="trend-chart__bar" style="height:${height}%" title="${escapeHtml(formatMoney(amount))}"></div>
            <span class="trend-chart__label">${escapeHtml(label)}</span>
          </div>
        `;
      }).join("")}
    </div>
    <p class="trend-chart__summary">
      This month: ${escapeHtml(formatMoney(sorted[sorted.length - 1][1]))}
      ${sorted.length >= 2 ? ` | Last month: ${escapeHtml(formatMoney(sorted[sorted.length - 2][1]))}` : ""}
    </p>
  `;
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

  if (!filtered.length) {
    el.historyList.innerHTML = '<p class="empty-state">No matching records.</p>';
    return;
  }

  // Group by date
  const groups = new Map();
  for (const item of filtered) {
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

  const txQuery = query(collection(firestore, "users", user.uid, "transactions"), orderBy("occurredAt", "desc"));
  unsubList.push(
    onSnapshot(txQuery, { includeMetadataChanges: true }, async (snapshot) => {
      const incoming = [];
      for (const cloudDoc of snapshot.docs) {
        const remote = { id: cloudDoc.id, ...cloudDoc.data(), syncStatus: "synced", lastSyncError: "", syncedAt: new Date().toISOString() };
        const local = await getExpense(remote.id);
        if (!local || local.syncStatus === "synced" || String(remote.updatedAt) >= String(local.updatedAt)) {
          incoming.push(remote);
        }
      }
      if (incoming.length) { await bulkPutExpenses(incoming); await refreshUI(); }
    }, (error) => console.error("Cloud transactions listener error:", error))
  );

  const expensesQuery = query(collection(firestore, "users", user.uid, "expenses"), orderBy("occurredAt", "desc"));
  unsubList.push(
    onSnapshot(expensesQuery, { includeMetadataChanges: true }, async (snapshot) => {
      const incoming = [];
      for (const cloudDoc of snapshot.docs) {
        const remote = { id: cloudDoc.id, ...cloudDoc.data(), syncStatus: "synced", lastSyncError: "", syncedAt: new Date().toISOString() };
        const local = await getExpense(remote.id);
        if (!local || local.syncStatus === "synced" || String(remote.updatedAt) >= String(local.updatedAt)) {
          incoming.push(remote);
        }
      }
      if (incoming.length) { await bulkPutExpenses(incoming); await refreshUI(); }
    }, (error) => console.error("Cloud expenses listener error:", error))
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

  if (!amount || amount <= 0) {
    showMessage(el.composerMessage, "Amount must be greater than zero.", true);
    return;
  }
  if (!description) {
    showMessage(el.composerMessage, "Please enter a description.", true);
    return;
  }

  let transaction;

  if (txType === "transfer") {
    const fromId = el.txFromAccount.value;
    const toId = el.txToAccount.value;
    if (!fromId || !toId) { showMessage(el.composerMessage, "Please select both accounts.", true); return; }
    if (fromId === toId) { showMessage(el.composerMessage, "Source and destination cannot be the same.", true); return; }

    const fromBalance = getAccountBalance(fromId);
    if (amount > fromBalance) {
      const ok = await showConfirm("Insufficient Balance", `Current balance: ${formatMoney(fromBalance)}. After: ${formatMoney(fromBalance - amount)}. Continue?`);
      if (!ok) return;
    }

    transaction = {
      id: crypto.randomUUID(), type: "transfer", amount, accountId: null,
      fromAccountId: fromId, toAccountId: toId, category: "Transfer", description, dateKey,
      occurredAt: `${dateKey}T${new Date().toTimeString().slice(0, 8)}.000Z`,
      createdAt: now, updatedAt: now, deleted: false, syncStatus: "pending", lastSyncError: "",
    };
    lastSelectedAccountId = fromId;
  } else {
    const accountId = el.txAccount.value;
    if (!accountId) { showMessage(el.composerMessage, "Please select an account.", true); return; }

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
      occurredAt: `${dateKey}T${new Date().toTimeString().slice(0, 8)}.000Z`,
      createdAt: now, updatedAt: now, deleted: false, syncStatus: "pending", lastSyncError: "",
    };
    lastSelectedAccountId = accountId;
  }

  await putExpense(transaction);

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
  lastSelectedAccountId = accountId;
  el.quickAddInput.value = "";
  await refreshUI();
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
    updated = { ...existing, type: "transfer", amount, accountId: null, fromAccountId: fromId, toAccountId: toId, category: "Transfer", description, dateKey, occurredAt: `${dateKey}T${new Date().toTimeString().slice(0, 8)}.000Z`, updatedAt: now, syncStatus: "pending", lastSyncError: "" };
  } else {
    const accountId = editAccount ? editAccount.value : "";
    if (!accountId) { showMessage(editMsg, "Please select an account.", true); return; }
    updated = { ...existing, type, amount, accountId, fromAccountId: type === "debit" ? accountId : null, toAccountId: type === "credit" ? accountId : null, category, description, dateKey, occurredAt: `${dateKey}T${new Date().toTimeString().slice(0, 8)}.000Z`, updatedAt: now, syncStatus: "pending", lastSyncError: "" };
  }

  await putExpense(updated);
  closeModal(modal);
  await refreshUI();
  syncPendingRecords();
  showToast("Transaction updated.");
}

async function deleteExpense(id) {
  const existing = await getExpense(id);
  if (!existing) return;
  const confirmed = await showConfirm("Delete Transaction", `Delete "${existing.description || "this transaction"}"?`);
  if (!confirmed) return;

  await putExpense({ ...existing, deleted: true, updatedAt: new Date().toISOString(), syncStatus: "pending", lastSyncError: "" });
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
function openModal(modalEl) { modalEl.classList.remove("hidden"); document.body.classList.add("modal-open"); }
function closeModal(modalEl) { modalEl.classList.add("hidden"); document.body.classList.remove("modal-open"); }

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
  if (!name) { showMessage(el.accountModalMessage, "Account name is required.", true); return; }

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
      <div class="chat-bubble ${bubbleClass}" data-id="${escapeHtml(item.id)}">
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
  const text = chatInput.value.trim();
  if (!text) return;

  const accountId = activityViewAccountId;
  if (!accountId) return;

  const parsed = parseExpense(text);
  if (!parsed.valid) { showToast(parsed.error || "Could not parse. Try: Lunch 150"); return; }

  // Determine type: if user forced a type via chip, use that; otherwise use parser result
  let txType;
  if (chatForceType) {
    txType = chatForceType;
  } else {
    txType = parsed.type === "income" ? "credit" : "debit";
  }

  // Check balance for debits
  if (txType === "debit") {
    const currentBalance = getAccountBalance(accountId);
    if (parsed.amount > currentBalance) {
      const ok = await showConfirm("Insufficient Balance", `Current: ${formatMoney(currentBalance)}. After: ${formatMoney(currentBalance - parsed.amount)}. Continue?`);
      if (!ok) return;
    }
  }

  const now = new Date().toISOString();
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
  chatInput.value = "";
  chatForceType = null;
  updateChatTypeIndicator();

  await refreshUI();
  renderAccountActivity(accountId);

  // Update balance in header
  const balance = getAccountBalance(accountId);
  el.accountActivityBalance.textContent = formatMoney(balance);

  showToast(`${txType === "credit" ? "Credit" : "Debit"}: ${formatMoney(parsed.amount)}`);
  syncPendingRecords();
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
  if (!amount || amount <= 0) { showMessage(el.budgetModalMessage, "Enter a valid budget amount.", true); return; }

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
  closeModal(el.budgetModal);
  await refreshUI();
  showToast(`Budget set: ${formatMoney(amount)}/month for ${category}.`);
}

async function handleDeleteBudget(budgetId) {
  const confirmed = await showConfirm("Remove Budget", "Remove this budget limit?");
  if (!confirmed) return;
  await deleteBudget(budgetId);
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

async function importJson(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    let transactions, accounts;
    if (Array.isArray(data)) { transactions = data; accounts = []; }
    else { transactions = data.transactions || []; accounts = data.accounts || []; }

    const now = new Date().toISOString();
    const records = transactions.map((item) => ({ ...item, id: item.id || crypto.randomUUID(), updatedAt: item.updatedAt || now, createdAt: item.createdAt || now, syncStatus: "pending", lastSyncError: "" }));
    await bulkPutExpenses(records);
    for (const account of accounts) { await putAccount({ ...account, syncStatus: "pending", lastSyncError: "" }); }

    if (data.budgets) { for (const b of data.budgets) await putBudget(b); }
    if (data.recurring) { for (const r of data.recurring) await putRecurring(r); }

    await refreshUI();
    showToast(`${records.length} records restored.`);
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

// ── Settings Panel ──────────────────────────────────────────────────────────
function openSettings() { el.settingsPanel.classList.remove("hidden"); el.settingsPanel.classList.add("open"); }
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

// Tab navigation
for (const tab of tabs) {
  tab.btn.addEventListener("click", () => switchTab(tab.key));
}

// FAB
if (el.fabBtn) el.fabBtn.addEventListener("click", () => switchTab("add"));

// Settings
el.settingsBtn.addEventListener("click", openSettings);
document.querySelectorAll('[data-action="close-settings"]').forEach((btn) => btn.addEventListener("click", closeSettings));

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

// History filters
if (el.searchInput) el.searchInput.addEventListener("input", renderHistory);
if (el.typeFilter) el.typeFilter.addEventListener("change", renderHistory);
if (el.accountFilter) el.accountFilter.addEventListener("change", renderHistory);
if (el.dateRangeStart) el.dateRangeStart.addEventListener("change", renderHistory);
if (el.dateRangeEnd) el.dateRangeEnd.addEventListener("change", renderHistory);
if (el.amountMin) el.amountMin.addEventListener("change", renderHistory);
if (el.amountMax) el.amountMax.addEventListener("change", renderHistory);

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
  renderHistory();
  closeFilterSheet();
}));

// View all history from dashboard
document.querySelectorAll('[data-action="view-all-history"]').forEach((btn) => btn.addEventListener("click", () => switchTab("history")));

// Export/Import
if (el.exportCsvBtn) el.exportCsvBtn.addEventListener("click", exportCsv);
if (el.exportJsonBtn) el.exportJsonBtn.addEventListener("click", exportJson);
if (el.syncNowBtn) el.syncNowBtn.addEventListener("click", async () => { await syncPendingRecords(); showToast(navigator.onLine ? "Sync completed." : "Still offline."); });
if (el.importJsonInput) el.importJsonInput.addEventListener("change", (event) => { const [file] = event.target.files; if (file) importJson(file); });

// History item actions (edit/delete)
if (el.historyList) el.historyList.addEventListener("click", (event) => {
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

// Chat send button & input
const chatSendBtn = document.querySelector("#chatSendBtn");
const chatInput = document.querySelector("#chatInput");
if (chatSendBtn) chatSendBtn.addEventListener("click", handleChatSend);
if (chatInput) chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleChatSend(); });

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

// Close modals on backdrop/close-button
document.addEventListener("click", (event) => {
  if (event.target.classList.contains("modal-overlay") && event.target !== el.confirmModal) { closeModal(event.target); return; }
  const closeBtn = event.target.closest("[data-modal].modal-close-btn");
  if (closeBtn) { const modal = document.querySelector(`#${closeBtn.dataset.modal}`); if (modal) closeModal(modal); }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!el.confirmModal.classList.contains("hidden")) { handleConfirmNo(); return; }
  const open = document.querySelector(".modal-overlay:not(.hidden)");
  if (open) closeModal(open);
  if (el.settingsPanel.classList.contains("open")) closeSettings();
  if (el.filterSheet.classList.contains("open")) closeFilterSheet();
});

// ── Initialization ──────────────────────────────────────────────────────────
async function initialize() {
  await initDarkMode();
  await loadDefaultAccount();
  await loadUserName();
  setNetworkBadge();
  if (el.txDate) el.txDate.value = localDateKey();
  await restoreLastTab();
  await refreshUI();

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
