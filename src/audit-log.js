import { dbPromise, getSetting, putSetting } from "./local-db.js";

const AUDIT_STORE = "auditLog";
const PRUNE_DAYS = 90;

function computeDiff(prev, next) {
  if (!prev || !next) return null;
  const diff = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === "syncStatus" || key === "lastSyncError" || key === "syncedAt" || key === "updatedAt") continue;
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      diff[key] = { from: prev[key], to: next[key] };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

export async function logAudit(entityType, entityId, action, previousValues, newValues) {
  const db = await dbPromise;
  const changes = action === "update" ? computeDiff(previousValues, newValues) : null;

  if (action === "update" && !changes) return;

  const entry = {
    id: crypto.randomUUID(),
    entityType,
    entityId,
    action,
    timestamp: new Date().toISOString(),
    changes,
    previousValues: action === "delete" ? previousValues : null,
    newValues: action === "create" ? newValues : null,
  };

  await db.put(AUDIT_STORE, entry);
}

export async function getAuditLog(limit = 100, offset = 0) {
  const db = await dbPromise;
  const tx = db.transaction(AUDIT_STORE, "readonly");
  const index = tx.store.index("by-timestamp");
  const results = [];
  let skipped = 0;
  let cursor = await index.openCursor(null, "prev");
  while (cursor && results.length < limit) {
    if (skipped < offset) { skipped++; cursor = await cursor.continue(); continue; }
    results.push(cursor.value);
    cursor = await cursor.continue();
  }
  return results;
}

export async function getAuditLogForEntity(entityType, entityId) {
  const db = await dbPromise;
  const entries = await db.getAllFromIndex(AUDIT_STORE, "by-entity", [entityType, entityId]);
  entries.reverse();
  return entries;
}

export async function getAuditLogCount() {
  const db = await dbPromise;
  return db.count(AUDIT_STORE);
}

export async function pruneOldAuditEntries() {
  const lastPrune = await getSetting("lastAuditPrune");
  const today = new Date().toISOString().slice(0, 10);
  if (lastPrune === today) return;

  const db = await dbPromise;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);
  const cutoffISO = cutoff.toISOString();

  const tx = db.transaction(AUDIT_STORE, "readwrite");
  const index = tx.store.index("by-timestamp");
  let cursor = await index.openCursor();

  while (cursor) {
    if (cursor.value.timestamp < cutoffISO) {
      await cursor.delete();
    } else {
      break;
    }
    cursor = await cursor.continue();
  }

  await tx.done;
  await putSetting("lastAuditPrune", today);
}

export function formatAuditEntry(entry) {
  const actionLabels = { create: "Created", update: "Edited", delete: "Deleted" };
  const entityLabels = { expense: "transaction", account: "account", budget: "budget" };
  const actionLabel = actionLabels[entry.action] || entry.action;
  const entityLabel = entityLabels[entry.entityType] || entry.entityType;

  let description = `${actionLabel} ${entityLabel}`;

  if (entry.action === "update" && entry.changes) {
    const fields = Object.keys(entry.changes);
    if (fields.length <= 3) {
      const details = fields.map((field) => {
        const { from, to } = entry.changes[field];
        if (field === "amount") return `amount: ${from} → ${to}`;
        if (field === "deleted" && to === true) return "marked as deleted";
        if (field === "description") return `description: "${from || ""}" → "${to || ""}"`;
        return `${field} changed`;
      });
      description += ` — ${details.join(", ")}`;
    } else {
      description += ` — ${fields.length} fields changed`;
    }
  }

  if (entry.action === "create" && entry.newValues) {
    const name = entry.newValues.description || entry.newValues.name || "";
    if (name) description += `: "${name}"`;
  }

  if (entry.action === "delete" && entry.previousValues) {
    const name = entry.previousValues.description || entry.previousValues.name || "";
    if (name) description += `: "${name}"`;
  }

  return description;
}

export function relativeTime(isoString) {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(isoString).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
