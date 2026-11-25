// ── Custom Service Worker ────────────────────────────────────────────────────
// Extends Workbox precaching with background water rotation reminders.
// Uses Periodic Background Sync to fire notifications even when the app is closed.

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// ── Workbox Precaching & Routing ────────────────────────────────────────────

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// Precache all built assets (injected by VitePWA at build time)
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback
const navHandler = createHandlerBoundToURL("/index.html");
registerRoute(new NavigationRoute(navHandler));

// Runtime caching: Tesseract.js CDN
registerRoute(
  /cdn\.jsdelivr\.net\/npm\/tesseract/,
  new CacheFirst({
    cacheName: "tesseract-cache",
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// Runtime caching: Web fonts
registerRoute(
  /\.(woff2?|ttf|otf)$/,
  new CacheFirst({
    cacheName: "font-cache",
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 }),
    ],
  })
);

// ── Water Rotation Reminder (Background) ────────────────────────────────────
// These functions run entirely within the service worker, using raw IndexedDB
// (the `idb` library isn't available here). This allows reminders to fire
// even when the main app tab is closed.

const DB_NAME = "my-expense-tracker";
const DB_VERSION = 7;
const WATER_STORE = "waterRotations";
const SETTINGS_STORE = "settings";

/**
 * Open IndexedDB directly (raw API, no idb wrapper).
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    // If the DB doesn't exist yet or needs upgrade, don't create stores here —
    // the main app handles that. Just open read-only.
    req.onupgradeneeded = () => {
      // Close and reject — the main app must initialize the DB first
      req.transaction.abort();
      reject(new Error("DB not initialized yet"));
    };
  });
}

/**
 * Get all active water rotations from IndexedDB.
 * @returns {Promise<Array>}
 */
async function getActiveRotations() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(WATER_STORE, "readonly");
      const store = tx.objectStore(WATER_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).filter((r) => r.active));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Read a setting from IndexedDB.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getSetting(key) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, "readonly");
      const store = tx.objectStore(SETTINGS_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Write a setting to IndexedDB.
 * @param {string} key
 * @param {any} value
 */
async function putSetting(key, value) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, "readwrite");
      const store = tx.objectStore(SETTINGS_STORE);
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Today as "YYYY-MM-DD" in local time */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Check if the current time is at or past the rotation's reminder time.
 * @param {{ reminderTime: string }} rotation — reminderTime as "HH:MM"
 * @returns {boolean}
 */
function isReminderTime(rotation) {
  if (!rotation.reminderTime) return true; // No time set → always due
  const [h, m] = rotation.reminderTime.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return true;
  const now = new Date();
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

/**
 * Check all active rotations and show notifications for due ones.
 * Uses a persistent "shown" record in IndexedDB Settings store to avoid
 * duplicate notifications across SW restarts.
 */
async function checkAndNotify() {
  try {
    const rotations = await getActiveRotations();
    const today = todayKey();

    // Load the set of already-shown notification keys from DB
    const shownRaw = (await getSetting("sw-shown-notifications")) || [];
    const shownSet = new Set(shownRaw);

    let newShown = false;

    for (const rot of rotations) {
      if (rot.nextDate !== today) continue;
      if (!isReminderTime(rot)) continue;

      const key = `${rot.id}:${today}`;
      if (shownSet.has(key)) continue;

      // Show notification via service worker registration
      await self.registration.showNotification(`🚰 ${rot.name}`, {
        body: "Innikku thanneer murai! 💧 (Tonight is your water turn)",
        tag: `water-${rot.id}-${today}`,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        requireInteraction: true,
        renotify: false,
        data: { rotationId: rot.id, type: "water-reminder", url: "/" },
      });

      shownSet.add(key);
      newShown = true;
    }

    if (newShown) {
      // Persist the shown set (keep only today's entries)
      const todayEntries = [...shownSet].filter((k) => k.endsWith(`:${today}`));
      await putSetting("sw-shown-notifications", todayEntries);
    }
  } catch (err) {
    // Silently fail — DB may not be initialized yet or no rotations exist
    console.warn("[SW] Water reminder check failed:", err);
  }
}

// ── Periodic Background Sync ────────────────────────────────────────────────
// Fires even when the app is closed. The browser decides the exact interval
// (minimum ~12 hours for installed PWAs), which is fine for daily reminders.

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "water-reminder-check") {
    event.waitUntil(checkAndNotify());
  }
});

// ── Regular Sync (Fallback) ─────────────────────────────────────────────────
// If periodic sync isn't available, a one-shot sync can still fire when
// connectivity changes or the browser decides to wake us.

self.addEventListener("sync", (event) => {
  if (event.tag === "water-reminder-check") {
    event.waitUntil(checkAndNotify());
  }
});

// ── Notification Click ──────────────────────────────────────────────────────
// When the user clicks a water reminder notification, focus or open the app.

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Focus existing app window if available
      for (const client of windowClients) {
        if (new URL(client.url).pathname === "/" && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(urlToOpen);
    })
  );
});

// ── Message Handler ─────────────────────────────────────────────────────────
// The main thread can ask us to check reminders immediately via postMessage.
// This is useful when the app opens and wants to trigger an immediate check.

self.addEventListener("message", (event) => {
  if (event.data?.type === "CHECK_WATER_REMINDERS") {
    event.waitUntil(checkAndNotify());
  }

  // Clear shown notifications cache (e.g. at midnight)
  if (event.data?.type === "RESET_SHOWN_NOTIFICATIONS") {
    event.waitUntil(putSetting("sw-shown-notifications", []));
  }
});
