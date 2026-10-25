/* Click-to-load wrapper. No third-party application is requested on page load. */
(() => {
  "use strict";
  const targets = Object.freeze({
    desktop: "https://demo.vektorium.io/",
    mobile: "https://mobile-demo.vektorium.io/demo",
    standby: "https://demo.vektorium.io/demo?mode=standby&autostart=true&fullscreen=true",
  });
  const frame = document.getElementById("demo-frame");
  const loadButton = document.getElementById("load-demo");
  const stopButton = document.getElementById("stop-demo");
  const fullscreenButton = document.getElementById("fullscreen-demo");
  const shell = document.querySelector(".demo-shell");
  const placeholder = document.getElementById("demo-placeholder");
  const viewport = document.getElementById("simulation-view");
  const status = document.getElementById("demo-status");
  const externalLink = document.getElementById("open-demo");
  if (!shell || !frame || !loadButton || !stopButton || !placeholder || !viewport || !status) return;
  // The control is hidden in the document until its behavior is available.
  loadButton.hidden = false;
  let active = false;
  let awaitingLoad = false;
  let timeoutId;
  let wasFullscreen = false;
  let viewportExpanded = false;
  let fullscreenPending = false;
  let fullscreenRequest = 0;
  let savedScroll;
  let savedShellSemantics;
  let inertSiblings = [];
  const supportsFullscreen = Boolean(shell && document.fullscreenEnabled && typeof shell.requestFullscreen === "function");

  function updateFullscreenControl() {
    if (!fullscreenButton) return;
    const expanded = document.fullscreenElement === shell || viewportExpanded;
    fullscreenButton.hidden = !active;
    fullscreenButton.textContent = expanded ? "Exit full screen" : "Full screen";
    fullscreenButton.setAttribute("aria-pressed", String(expanded));
    if (wasFullscreen && !expanded && active) fullscreenButton.focus({ preventScroll: true });
    wasFullscreen = expanded;
  }

  function expandViewport() {
    if (!active || viewportExpanded) return;
    savedScroll = { x: window.scrollX, y: window.scrollY };
    savedShellSemantics = { role: shell.getAttribute("role"), modal: shell.getAttribute("aria-modal") };
    // Keep the existing iframe connected: moving or rebuilding it reloads the demo.
    viewportExpanded = true;
    shell.classList.add("is-expanded");
    document.documentElement.classList.add("demo-viewport-expanded");
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-modal", "true");
    // Keep keyboard focus out of the page hidden behind the expanded view.
    for (let current = shell; current.parentElement && current.parentElement !== document.documentElement; current = current.parentElement) {
      for (const sibling of current.parentElement.children) {
        if (sibling === current || ["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)) continue;
        inertSiblings.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
    }
    updateFullscreenControl();
    fullscreenButton?.focus({ preventScroll: true });
  }

  function collapseViewport() {
    if (!viewportExpanded) return;
    viewportExpanded = false;
    shell.classList.remove("is-expanded");
    document.documentElement.classList.remove("demo-viewport-expanded");
    for (const { element, inert } of inertSiblings) element.inert = inert;
    inertSiblings = [];
    if (savedShellSemantics.role === null) shell.removeAttribute("role");
    else shell.setAttribute("role", savedShellSemantics.role);
    if (savedShellSemantics.modal === null) shell.removeAttribute("aria-modal");
    else shell.setAttribute("aria-modal", savedShellSemantics.modal);
    window.scrollTo(savedScroll.x, savedScroll.y);
    updateFullscreenControl();
  }

  function selectedTarget() {
    if (document.body.dataset.demoVariant === "standby") return targets.standby;
    const smallScreen = window.matchMedia("(max-width: 767px)").matches;
    const mobileDevice = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return smallScreen || mobileDevice ? targets.mobile : targets.desktop;
  }
  function updateDestination() {
    const target = selectedTarget();
    if (externalLink) externalLink.href = target;
    return target;
  }
  function setStatus(state, message) {
    status.dataset.state = state;
    status.textContent = message;
  }
  function stopDemo(restoreFocus) {
    window.clearTimeout(timeoutId);
    active = false;
    awaitingLoad = false;
    fullscreenRequest += 1;
    fullscreenPending = false;
    collapseViewport();
    frame.removeAttribute("src");
    frame.hidden = true;
    placeholder.hidden = false;
    stopButton.hidden = true;
    updateFullscreenControl();
    if (document.fullscreenElement === shell) {
      document.exitFullscreen().then(() => {
        if (restoreFocus && !active) loadButton.focus();
      }).catch(() => {});
    }
    viewport.removeAttribute("aria-busy");
    setStatus("idle", "");
    updateDestination();
    if (restoreFocus) loadButton.focus();
  }
  loadButton.addEventListener("click", () => {
    if (active) return;
    const target = updateDestination();
    active = true;
    awaitingLoad = true;
    placeholder.hidden = true;
    frame.hidden = false;
    stopButton.hidden = false;
    updateFullscreenControl();
    viewport.setAttribute("aria-busy", "true");
    setStatus("loading", "Loading demo…");
    frame.src = target;
    stopButton.focus();
    timeoutId = window.setTimeout(() => {
      if (!active || !awaitingLoad) return;
      viewport.removeAttribute("aria-busy");
      setStatus("waiting", "Still loading. Try Open in new tab if the demo does not appear.");
    }, 15000);
  });
  frame.addEventListener("load", () => {
    if (!active || !awaitingLoad) return;
    window.clearTimeout(timeoutId);
    awaitingLoad = false;
    viewport.removeAttribute("aria-busy");
    // A cross-origin frame load event cannot establish application health.
    setStatus("loaded", "");
  });
  frame.addEventListener("error", () => {
    if (!active) return;
    window.clearTimeout(timeoutId);
    awaitingLoad = false;
    viewport.removeAttribute("aria-busy");
    setStatus("error", "The demo could not load. Try Open in new tab.");
  });
  stopButton.addEventListener("click", () => stopDemo(true));
  fullscreenButton?.addEventListener("click", async () => {
    if (!active || fullscreenPending) return;
    if (viewportExpanded) {
      collapseViewport();
      return;
    }
    if (document.fullscreenElement === shell) {
      try { await document.exitFullscreen(); }
      catch { setStatus("waiting", "Full screen is unavailable. Use Open in new tab."); }
      return;
    }
    if (!supportsFullscreen) {
      expandViewport();
      return;
    }
    const request = ++fullscreenRequest;
    fullscreenPending = true;
    try {
      await shell.requestFullscreen();
      // Stop may have happened while the browser was deciding the request.
      if ((!active || request !== fullscreenRequest) && document.fullscreenElement === shell) {
        await document.exitFullscreen();
      }
    } catch {
      if (active && request === fullscreenRequest) expandViewport();
    } finally {
      if (request === fullscreenRequest) fullscreenPending = false;
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && viewportExpanded) {
      event.preventDefault();
      collapseViewport();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    updateFullscreenControl();
    // If a pending request completes after Stop, do not leave an idle frame expanded.
    if (!active && document.fullscreenElement === shell) document.exitFullscreen().catch(() => {});
  });
  externalLink?.addEventListener("click", updateDestination);
  window.addEventListener("pagehide", () => {
    if (active) stopDemo(false);
  });
  updateDestination();
})();
