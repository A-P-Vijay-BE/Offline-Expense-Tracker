// ── Water Turn Reminder Engine ──────────────────────────────────────────────
// Handles notification permissions, scheduling checks, and browser
// notifications for Thanneer Murai (water rotation) reminders.

/** Set of "id:date" keys for notifications already fired this session */
const shownNotifications = new Set();

// ── Notification Permission ────────────────────────────────────────────────

/**
 * Request browser notification permission.
 * @returns {Promise<"granted"|"denied"|"default">}
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

/**
 * @returns {"granted"|"denied"|"default"|"unsupported"}
 */
export function getNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// ── Date Helpers ───────────────────────────────────────────────────────────

/** Today as "YYYY-MM-DD" in local time */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse "YYYY-MM-DD" into a Date at midnight local time */
function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Calculate the next rotation date.
 * @param {string} currentDate — "YYYY-MM-DD"
 * @param {number} cycleDays — days between turns
 * @returns {string} "YYYY-MM-DD"
 */
export function calculateNextDate(currentDate, cycleDays) {
  const d = parseDate(currentDate);
  d.setDate(d.getDate() + cycleDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Check if a rotation's nextDate is today.
 * @param {{ nextDate: string }} rotation
 * @returns {boolean}
 */
export function isReminderDueToday(rotation) {
  return rotation.nextDate === todayKey();
}

/**
 * Check if the current time is at or past the rotation's reminder time.
 * @param {{ reminderTime: string }} rotation — reminderTime as "HH:MM"
 * @returns {boolean}
 */
function isReminderTime(rotation) {
  if (!rotation.reminderTime) return false;
  const [h, m] = rotation.reminderTime.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const now = new Date();
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

/**
 * Format a date string relative to today.
 * @param {string} dateStr — "YYYY-MM-DD"
 * @returns {string} e.g. "Today", "Tomorrow", "In 3 days", "Yesterday", "2 days ago"
 */
export function formatRelativeDate(dateStr) {
  const target = parseDate(dateStr);
  const today = parseDate(todayKey());
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1) return `In ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

// ── Notification Display ───────────────────────────────────────────────────

/**
 * Show a browser notification for a water rotation.
 * @param {{ id: string, name: string, nextDate: string }} rotation
 */
function showWaterNotification(rotation) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const key = `${rotation.id}:${rotation.nextDate}`;
  if (shownNotifications.has(key)) return;

  const notifOpts = {
    body: "Innikku thanneer murai! (Tonight is your water turn)",
    tag: rotation.id,
    icon: "/icons/icon-192.png",
    requireInteraction: true,
  };

  let delivered = false;

  try {
    new Notification(`🚰 ${rotation.name}`, notifOpts);
    delivered = true;
  } catch (_err) {
    // Notification constructor may throw on some mobile browsers;
    // fall back to service worker notification if available.
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification(`🚰 ${rotation.name}`, notifOpts);
        shownNotifications.add(key); // mark only on successful SW delivery
      }).catch(() => {});
      return; // SW path marks async — exit here
    }
  }

  // Only mark as shown if delivery succeeded (prevents permanent suppression on failure)
  if (delivered) {
    shownNotifications.add(key);
  }
}

// ── Reminder Check Loop ────────────────────────────────────────────────────

/**
 * Check all rotations and fire notifications for any that are due.
 * @param {Array} rotations — water rotation objects from DB
 * @returns {Array} rotations that triggered a notification this call
 */
function checkWaterReminders(rotations) {
  const triggered = [];

  for (const rot of rotations) {
    if (!rot.active) continue;
    if (!isReminderDueToday(rot)) continue;
    if (!isReminderTime(rot)) continue;

    const key = `${rot.id}:${rot.nextDate}`;
    if (shownNotifications.has(key)) continue;

    showWaterNotification(rot);
    triggered.push(rot);
  }

  return triggered;
}

/**
 * Start a background loop that checks reminders every 60 seconds.
 * @param {() => Promise<Array>} getRotationsFn — async function returning current rotations
 * @param {(triggered: Array) => void} [onTrigger] — optional callback when reminders fire
 * @returns {() => void} cleanup function to stop the loop
 */
export function startReminderLoop(getRotationsFn, onTrigger) {
  let running = true;

  async function tick() {
    if (!running) return;
    try {
      const rotations = await getRotationsFn();
      const triggered = checkWaterReminders(rotations);
      if (triggered.length > 0 && typeof onTrigger === "function") {
        onTrigger(triggered);
      }
    } catch (err) {
      console.warn("Reminder check failed:", err);
    }
  }

  // First tick after 3 seconds (let DB initialize), then every 30 seconds
  const timeoutId = setTimeout(tick, 3000);
  const intervalId = setInterval(tick, 30_000);

  return function stopReminderLoop() {
    running = false;
    clearTimeout(timeoutId);
    clearInterval(intervalId);
  };
}

/**
 * Clear the shown-notifications cache (e.g. at midnight or on date change).
 */
export function resetShownNotifications() {
  shownNotifications.clear();
}
