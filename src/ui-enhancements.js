// ── UI Enhancements: Animations, Transitions, Interactions ──────────────────

// Animated number counter
export function animateValue(element, start, end, duration = 600) {
  if (!element) return;
  const startTime = performance.now();
  const diff = end - start;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + diff * eased;
    element.textContent = element._formatter ? element._formatter(current) : Math.round(current).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

// Touch ripple effect
export function initRippleEffect() {
  document.addEventListener("pointerdown", (e) => {
    const target = e.target.closest(".tab-nav__btn, .primary-btn, .secondary-btn, .small-btn, .tx-type-btn, .quick-chip, .fab, .icon-btn");
    if (!target || e.button !== 0) return;

    const rect = target.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple-effect";
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    target.style.position = target.style.position || "relative";
    target.style.overflow = "hidden";
    target.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  });
}

// Page transition for tab switching
export function initPageTransitions() {
  const panels = document.querySelectorAll(".tab-panel");
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === "hidden" && !m.target.hidden) {
        m.target.classList.add("tab-panel--entering");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            m.target.classList.remove("tab-panel--entering");
          });
        });
      }
    }
  });
  panels.forEach((p) => observer.observe(p, { attributes: true }));
}

// Scroll-linked header blur
export function initScrollHeader() {
  const header = document.querySelector(".topbar");
  if (!header) return;
  let ticking = false;

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      header.classList.toggle("topbar--scrolled", window.scrollY > 10);
      ticking = false;
    });
  }, { passive: true });
}

// Pull-to-refresh
export function initPullToRefresh(refreshCallback) {
  let startY = 0;
  let pulling = false;
  const threshold = 80;
  let indicator = document.querySelector(".ptr-indicator");

  if (!indicator) {
    indicator = document.createElement("div");
    indicator.className = "ptr-indicator";
    indicator.innerHTML = '<div class="ptr-spinner"></div><span>Pull to refresh</span>';
    document.querySelector("main")?.prepend(indicator);
  }

  document.addEventListener("touchstart", (e) => {
    if (window.scrollY === 0 && e.touches.length === 1) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0 && dy < 150) {
      indicator.style.transform = `translateY(${Math.min(dy * 0.5, 60)}px)`;
      indicator.style.opacity = Math.min(dy / threshold, 1);
      if (dy > threshold) indicator.classList.add("ptr-indicator--ready");
      else indicator.classList.remove("ptr-indicator--ready");
    }
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (!pulling) return;
    pulling = false;
    const ready = indicator.classList.contains("ptr-indicator--ready");
    indicator.style.transform = "";
    indicator.style.opacity = "";
    indicator.classList.remove("ptr-indicator--ready");
    if (ready) {
      indicator.classList.add("ptr-indicator--refreshing");
      if (navigator.vibrate) navigator.vibrate(30);
      refreshCallback().finally(() => {
        indicator.classList.remove("ptr-indicator--refreshing");
      });
    }
  });
}

// Haptic feedback
export function haptic(style = "light") {
  if (!navigator.vibrate) return;
  if (style === "light") navigator.vibrate(10);
  else if (style === "medium") navigator.vibrate(30);
  else if (style === "success") navigator.vibrate([20, 50, 20]);
}

// Success animation burst
export function showSuccessAnimation(container) {
  const burst = document.createElement("div");
  burst.className = "success-burst";
  burst.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" class="success-burst__circle"/><polyline points="8 12 11 15 16 9" class="success-burst__check"/></svg>';
  (container || document.body).appendChild(burst);
  burst.addEventListener("animationend", () => burst.remove());
}

// Lazy tab rendering
const renderedTabs = new Set(["dashboard"]);
export function shouldRenderTab(tabKey) {
  if (renderedTabs.has(tabKey)) return false;
  renderedTabs.add(tabKey);
  return true;
}

export function markTabRendered(tabKey) {
  renderedTabs.add(tabKey);
}

// Swipe gesture for tabs
export function initSwipeNavigation(tabs, switchTabFn) {
  let startX = 0;
  let startY = 0;
  let currentTab = 0;

  const main = document.querySelector("main");
  if (!main) return;

  main.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  main.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;

    const activeIdx = tabs.findIndex((t) => !t.panel.hidden);
    if (activeIdx === -1) return;

    if (dx < -60 && activeIdx < tabs.length - 1) {
      switchTabFn(tabs[activeIdx + 1].key);
      haptic("light");
    } else if (dx > 60 && activeIdx > 0) {
      switchTabFn(tabs[activeIdx - 1].key);
      haptic("light");
    }
  }, { passive: true });
}
