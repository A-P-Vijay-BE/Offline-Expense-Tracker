import { openDB } from "idb";

const DATABASE_NAME = "my-expense-tracker";
const DATABASE_VERSION = 7;
const STORE_NAME = "expenses";
const ACCOUNTS_STORE = "accounts";
const BUDGETS_STORE = "budgets";
const RECURRING_STORE = "recurring";
const SETTINGS_STORE = "settings";
const WATER_ROTATIONS_STORE = "waterRotations";

export const dbPromise = openDB(DATABASE_NAME, DATABASE_VERSION, {
  upgrade(db, oldVersion, _newVersion, transaction) {
    if (oldVersion < 1) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("by-date", "dateKey");
      store.createIndex("by-sync", "syncStatus");
      store.createIndex("by-updated", "updatedAt");
    }
    if (oldVersion < 2) {
      if (!db.objectStoreNames.contains(ACCOUNTS_STORE)) {
        const acctStore = db.createObjectStore(ACCOUNTS_STORE, {
          keyPath: "id",
        });
        acctStore.createIndex("by-sync", "syncStatus");
        acctStore.createIndex("by-updated", "updatedAt");
      }
      const expStore = transaction.objectStore(STORE_NAME);
      if (!expStore.indexNames.contains("by-account")) {
        expStore.createIndex("by-account", "accountId");
      }
    }
    if (oldVersion < 3) {
      const expStore = transaction.objectStore(STORE_NAME);
      if (!expStore.indexNames.contains("by-fromAccount")) {
        expStore.createIndex("by-fromAccount", "fromAccountId");
      }
      if (!expStore.indexNames.contains("by-toAccount")) {
        expStore.createIndex("by-toAccount", "toAccountId");
      }
      const acctStore = transaction.objectStore(ACCOUNTS_STORE);
      if (!acctStore.indexNames.contains("by-name")) {
        acctStore.createIndex("by-name", "name");
      }
    }
    if (oldVersion < 4) {
      if (!db.objectStoreNames.contains(BUDGETS_STORE)) {
        const budgetStore = db.createObjectStore(BUDGETS_STORE, {
          keyPath: "id",
        });
        budgetStore.createIndex("by-category", "category");
        budgetStore.createIndex("by-month", "monthKey");
      }
      if (!db.objectStoreNames.contains(RECURRING_STORE)) {
        const recurStore = db.createObjectStore(RECURRING_STORE, {
          keyPath: "id",
        });
        recurStore.createIndex("by-next", "nextOccurrence");
        recurStore.createIndex("by-active", "active");
      }
    }
    if (oldVersion < 5) {
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    }
    if (oldVersion < 6) {
      if (!db.objectStoreNames.contains("auditLog")) {
        const auditStore = db.createObjectStore("auditLog", { keyPath: "id" });
        auditStore.createIndex("by-entity", ["entityType", "entityId"]);
        auditStore.createIndex("by-timestamp", "timestamp");
      }
    }
    if (oldVersion < 7) {
      if (!db.objectStoreNames.contains(WATER_ROTATIONS_STORE)) {
        const waterStore = db.createObjectStore(WATER_ROTATIONS_STORE, {
          keyPath: "id",
        });
        waterStore.createIndex("by-active", "active");
        waterStore.createIndex("by-next", "nextDate");
      }
    }
  },
});

// ── Expenses ────────────────────────────────────────────────────────

export async function putExpense(expense) {
  const db = await dbPromise;
  await db.put(STORE_NAME, expense);
  return expense;
}

export async function getExpense(id) {
  const db = await dbPromise;
  return db.get(STORE_NAME, id);
}

export async function getAllExpenses() {
  const db = await dbPromise;
  return db.getAll(STORE_NAME);
}

export async function getPendingExpenses() {
  const db = await dbPromise;
  const pending = await db.getAllFromIndex(STORE_NAME, "by-sync", "pending");
  const errored = await db.getAllFromIndex(STORE_NAME, "by-sync", "error");
  return [...pending, ...errored];
}

export async function markExpenseSynced(id) {
  const tx = (await dbPromise).transaction(STORE_NAME, "readwrite");
  const item = await tx.store.get(id);
  if (!item) return;
  item.syncStatus = "synced";
  item.lastSyncError = "";
  item.syncedAt = new Date().toISOString();
  await tx.store.put(item);
  await tx.done;
}

export async function markExpenseSyncError(id, message) {
  const tx = (await dbPromise).transaction(STORE_NAME, "readwrite");
  const item = await tx.store.get(id);
  if (!item) return;
  item.syncStatus = "error";
  item.lastSyncError = String(message || "Unknown sync error");
  await tx.store.put(item);
  await tx.done;
}

export async function bulkPutExpenses(expenses) {
  const db = await dbPromise;
  const tx = db.transaction(STORE_NAME, "readwrite");

  for (const expense of expenses) {
    await tx.store.put(expense);
  }

  await tx.done;
}

// ── Accounts ────────────────────────────────────────────────────────

export async function putAccount(account) {
  const db = await dbPromise;
  await db.put(ACCOUNTS_STORE, account);
  return account;
}

export async function getAccount(id) {
  const db = await dbPromise;
  return db.get(ACCOUNTS_STORE, id);
}

export async function getAllAccounts() {
  const db = await dbPromise;
  return db.getAll(ACCOUNTS_STORE);
}

export async function getPendingAccounts() {
  const db = await dbPromise;
  const pending = await db.getAllFromIndex(ACCOUNTS_STORE, "by-sync", "pending");
  const errored = await db.getAllFromIndex(ACCOUNTS_STORE, "by-sync", "error");
  return [...pending, ...errored];
}

export async function markAccountSynced(id) {
  const tx = (await dbPromise).transaction(ACCOUNTS_STORE, "readwrite");
  const item = await tx.store.get(id);
  if (!item) return;
  item.syncStatus = "synced";
  item.lastSyncError = "";
  item.syncedAt = new Date().toISOString();
  await tx.store.put(item);
  await tx.done;
}

export async function markAccountSyncError(id, message) {
  const tx = (await dbPromise).transaction(ACCOUNTS_STORE, "readwrite");
  const item = await tx.store.get(id);
  if (!item) return;
  item.syncStatus = "error";
  item.lastSyncError = String(message || "Unknown sync error");
  await tx.store.put(item);
  await tx.done;
}

// ── Budgets ─────────────────────────────────────────────────────────

export async function putBudget(budget) {
  const db = await dbPromise;
  await db.put(BUDGETS_STORE, budget);
  return budget;
}

export async function getAllBudgets() {
  const db = await dbPromise;
  return db.getAll(BUDGETS_STORE);
}

export async function deleteBudget(id) {
  const db = await dbPromise;
  await db.delete(BUDGETS_STORE, id);
}

// ── Recurring Transactions ──────────────────────────────────────────

export async function putRecurring(recurring) {
  const db = await dbPromise;
  await db.put(RECURRING_STORE, recurring);
  return recurring;
}

export async function getAllRecurring() {
  const db = await dbPromise;
  return db.getAll(RECURRING_STORE);
}

export async function deleteRecurring(id) {
  const db = await dbPromise;
  await db.delete(RECURRING_STORE, id);
}

export async function getActiveRecurring() {
  const db = await dbPromise;
  const all = await db.getAll(RECURRING_STORE);
  return all.filter((item) => item.active);
}

// ── Water Rotations (Thanneer Murai) ──────────────────────────────

export async function putWaterRotation(rotation) {
  const db = await dbPromise;
  await db.put(WATER_ROTATIONS_STORE, rotation);
  return rotation;
}

export async function getWaterRotation(id) {
  const db = await dbPromise;
  return db.get(WATER_ROTATIONS_STORE, id);
}

export async function getAllWaterRotations() {
  const db = await dbPromise;
  return db.getAll(WATER_ROTATIONS_STORE);
}

export async function deleteWaterRotation(id) {
  const db = await dbPromise;
  await db.delete(WATER_ROTATIONS_STORE, id);
}

export async function getActiveWaterRotations() {
  const db = await dbPromise;
  const all = await db.getAll(WATER_ROTATIONS_STORE);
  return all.filter((item) => item.active);
}

// ── Settings ────────────────────────────────────────────────────────

export async function getSetting(key) {
  const db = await dbPromise;
  const record = await db.get(SETTINGS_STORE, key);
  return record ? record.value : null;
}

export async function putSetting(key, value) {
  const db = await dbPromise;
  await db.put(SETTINGS_STORE, { key, value });
}
