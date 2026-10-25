/* Click-to-load wrapper. No third-party application is requested on page load. */
(() => {
  "use strict";
  const targets = Object.freeze({
    desktop: "https://cypher-sentinel-demo.vercel.app/",
    mobile: "https://mobile-gold-five.vercel.app/demo",
    standby: "https://cypher-sentinel-demo.vercel.app/demo?mode=standby&autostart=true&fullscreen=true",
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
  const destination = document.getElementById("demo-destination");
  if (!shell || !frame || !loadButton || !stopButton || !placeholder || !viewport || !status) return;
  // The control is hidden in the document until its behavior is available.
  loadButton.hidden = false;
  let active = false;
  let awaitingLoad = false;
  let timeoutId;
  let wasFullscreen = false;
  const supportsFullscreen = Boolean(shell && document.fullscreenEnabled && typeof shell.requestFullscreen === "function");

  function updateFullscreenControl() {
    if (!fullscreenButton) return;
    const expanded = document.fullscreenElement === shell;
    fullscreenButton.hidden = !active || !supportsFullscreen;
    fullscreenButton.textContent = expanded ? "Exit full screen" : "Full screen";
    fullscreenButton.setAttribute("aria-pressed", String(expanded));
    if (wasFullscreen && !expanded && active) fullscreenButton.focus();
    wasFullscreen = expanded;
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
    if (destination) destination.textContent = target === targets.mobile ? "mobile-gold-five.vercel.app" : "cypher-sentinel-demo.vercel.app";
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
    setStatus("idle", "The external demonstration is unloaded. You can start it again when you choose.");
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
    setStatus("loading", "Loading the external simulation. You can stop and unload it at any time.");
    frame.src = target;
    stopButton.focus();
    timeoutId = window.setTimeout(() => {
      if (!active || !awaitingLoad) return;
      viewport.removeAttribute("aria-busy");
      setStatus("waiting", "The external application is taking longer to load. If it stays blank, stop it and choose Open in new tab, or use the help below.");
    }, 15000);
  });
  frame.addEventListener("load", () => {
    if (!active || !awaitingLoad) return;
    window.clearTimeout(timeoutId);
    awaitingLoad = false;
    viewport.removeAttribute("aria-busy");
    // A cross-origin frame load event cannot establish application health.
    setStatus("loaded", "The external frame has loaded. If the application is blank or unavailable, use the help below.");
  });
  frame.addEventListener("error", () => {
    if (!active) return;
    window.clearTimeout(timeoutId);
    awaitingLoad = false;
    viewport.removeAttribute("aria-busy");
    setStatus("error", "The external frame could not be loaded. Stop it and use the help below or contact Vektorium.");
  });
  stopButton.addEventListener("click", () => stopDemo(true));
  fullscreenButton?.addEventListener("click", async () => {
    if (!active || !supportsFullscreen) return;
    try {
      if (document.fullscreenElement === shell) await document.exitFullscreen();
      else await shell.requestFullscreen();
    } catch {
      setStatus("waiting", "Full screen is unavailable in this browser. Keep using the embedded demo or choose Open in new tab in the toolbar.");
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
