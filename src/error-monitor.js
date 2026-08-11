const ERROR_LOG_KEY = "app_error_log";
const MAX_ERRORS = 50;

function getStoredErrors() {
  try {
    return JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function storeError(entry) {
  const errors = getStoredErrors();
  errors.unshift(entry);
  if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS;
  try {
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(errors));
  } catch { /* storage full */ }
}

function createErrorEntry(error, context = "") {
  return {
    message: error?.message || String(error),
    stack: error?.stack?.split("\n").slice(0, 5).join("\n") || "",
    context,
    url: location.href,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
  };
}

export function initErrorMonitor() {
  window.addEventListener("error", (event) => {
    const entry = createErrorEntry(event.error || event.message, "window.onerror");
    storeError(entry);
    console.error("[ErrorMonitor]", entry.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const entry = createErrorEntry(event.reason, "unhandledrejection");
    storeError(entry);
    console.error("[ErrorMonitor]", entry.message);
  });
}

export function reportError(error, context = "") {
  const entry = createErrorEntry(error, context);
  storeError(entry);
  console.error("[ErrorMonitor]", context, entry.message);
}

export function getErrorLog() {
  return getStoredErrors();
}

export function clearErrorLog() {
  localStorage.removeItem(ERROR_LOG_KEY);
}
