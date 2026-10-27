/* Optional enhancements for the native desktop navigation disclosure. */
(function () {
  'use strict';

  function initializeNavigation() {
    const menu = document.querySelector('.vx-desktop-menu');
    if (!menu || menu.dataset.vxNavigationReady === 'true') return;
    const summary = menu.querySelector('.vx-menu-toggle');
    const panel = menu.querySelector('.vx-desktop-panel');
    if (!summary || !panel) return;
    menu.dataset.vxNavigationReady = 'true';
    const desktopLayout = window.matchMedia('(min-width: 769px)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let focusTimer;
    let pointerInMenu = false;

    function closeMenu(restoreFocus) {
      window.clearTimeout(focusTimer);
      if (!menu.open) return;
      menu.open = false;
      if (restoreFocus) summary.focus({ preventScroll: true });
    }

    function cursorHover(active) {
      for (const id of ['cursorDot', 'cursorRing']) {
        const cursor = document.getElementById(id);
        if (cursor) cursor.classList.toggle('hovering', active);
      }
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !menu.open) return;
      closeMenu(true);
      event.preventDefault();
    });

    document.addEventListener('pointerdown', function (event) {
      pointerInMenu = menu.contains(event.target);
      if (!pointerInMenu) closeMenu(false);
    });
    document.addEventListener('pointerup', function () { pointerInMenu = false; });
    document.addEventListener('pointercancel', function () { pointerInMenu = false; });
    document.addEventListener('focusin', function (event) {
      window.clearTimeout(focusTimer);
      if (!menu.contains(event.target)) closeMenu(false);
    });
    menu.addEventListener('focusout', function (event) {
      window.clearTimeout(focusTimer);
      if (event.relatedTarget) {
        if (!menu.contains(event.relatedTarget)) closeMenu(false);
        return;
      }
      // Pointer focus can briefly pass through the body before a click finishes.
      focusTimer = window.setTimeout(function () {
        if (!pointerInMenu && !menu.contains(document.activeElement)) closeMenu(false);
      }, 0);
    });
    panel.addEventListener('click', function (event) {
      const link = event.target.closest && event.target.closest('a[href]');
      if (link && panel.contains(link)) closeMenu(false);
    });

    function onLayoutChange(event) {
      if (!event.matches) {
        closeMenu(false);
        cursorHover(false);
      }
    }
    if (desktopLayout.addEventListener) desktopLayout.addEventListener('change', onLayoutChange);
    else if (desktopLayout.addListener) desktopLayout.addListener(onLayoutChange);

    summary.addEventListener('pointerenter', function (event) {
      if (event.pointerType === 'mouse' && desktopLayout.matches && finePointer.matches) cursorHover(true);
    });
    summary.addEventListener('pointerleave', function () { cursorHover(false); });
    menu.addEventListener('pointermove', function (event) {
      if (event.pointerType !== 'mouse' || !desktopLayout.matches || !finePointer.matches || reducedMotion.matches) return;
      const surface = summary.contains(event.target) ? summary : panel;
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      surface.style.setProperty('--vx-menu-x', ((event.clientX - rect.left) / rect.width * 100).toFixed(1) + '%');
      surface.style.setProperty('--vx-menu-y', ((event.clientY - rect.top) / rect.height * 100).toFixed(1) + '%');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeNavigation, { once: true });
  else initializeNavigation();
}());
