const ANALYTICS_KEY = "app_analytics";
const SESSION_KEY = "app_session";
const MAX_EVENTS = 200;

let sessionId = null;
let sessionStart = null;

function getStoredEvents() {
  try {
    return JSON.parse(localStorage.getItem(ANALYTICS_KEY) || "[]");
  } catch {
    return [];
  }
}

function storeEvent(event) {
  const events = getStoredEvents();
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  try {
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(events));
  } catch { /* storage full */ }
}

export function initAnalytics() {
  sessionId = crypto.randomUUID();
  sessionStart = Date.now();

  const sessions = Number(localStorage.getItem(SESSION_KEY) || "0") + 1;
  localStorage.setItem(SESSION_KEY, String(sessions));

  trackEvent("session_start", { sessionNumber: sessions });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && sessionStart) {
      trackEvent("session_end", { durationMs: Date.now() - sessionStart });
    }
  });
}

export function trackEvent(name, data = {}) {
  storeEvent({
    event: name,
    ...data,
    sessionId,
    timestamp: new Date().toISOString(),
  });
}

export function trackScreen(screenName) {
  trackEvent("screen_view", { screen: screenName });
}

export function getAnalyticsSummary() {
  const events = getStoredEvents();
  const screens = events.filter((e) => e.event === "screen_view");
  const sessions = events.filter((e) => e.event === "session_start");
  const actions = events.filter((e) => e.event !== "screen_view" && e.event !== "session_start" && e.event !== "session_end");

  const screenCounts = {};
  for (const s of screens) {
    screenCounts[s.screen] = (screenCounts[s.screen] || 0) + 1;
  }

  return {
    totalSessions: sessions.length,
    totalEvents: events.length,
    topScreens: Object.entries(screenCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
    recentActions: actions.slice(-10),
  };
}

export function clearAnalytics() {
  localStorage.removeItem(ANALYTICS_KEY);
}
