/* Small enhancement for the native mobile menu. No visual-effect or analytics hooks. */
(function () {
  'use strict';

  function initializeMenu() {
    const header = document.querySelector('.vx-mobile-header');
    if (!header || header.dataset.vxMobileReady === 'true') return;
    const menu = header.querySelector('.vx-mobile-menu');
    const summary = menu && menu.querySelector('summary');
    const panel = menu && menu.querySelector('.vx-mobile-panel');
    if (!menu || !summary || !panel) return;
    header.dataset.vxMobileReady = 'true';
    let focusTimer;
    let pointerInHeader = false;

    function closeMenu(restoreFocus) {
      window.clearTimeout(focusTimer);
      if (!menu.open) return;
      menu.open = false;
      if (restoreFocus) summary.focus({ preventScroll: true });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !menu.open) return;
      closeMenu(true);
      event.preventDefault();
    });

    document.addEventListener('pointerdown', function (event) {
      // Do not steal focus from the control the visitor just clicked.
      pointerInHeader = header.contains(event.target);
      if (!pointerInHeader) closeMenu(false);
    });
    document.addEventListener('pointerup', function () { pointerInHeader = false; });
    document.addEventListener('pointercancel', function () { pointerInHeader = false; });
    document.addEventListener('focusin', function (event) {
      window.clearTimeout(focusTimer);
      if (!header.contains(event.target)) closeMenu(false);
    });

    header.addEventListener('focusout', function (event) {
      // This is a navigation disclosure, not a modal. Let Tab leave normally,
      // and close the panel so it cannot cover the newly focused page control.
      window.clearTimeout(focusTimer);
      if (event.relatedTarget) {
        if (!header.contains(event.relatedTarget)) closeMenu(false);
        return;
      }
      focusTimer = window.setTimeout(function () {
        if (!pointerInHeader && !header.contains(document.activeElement)) closeMenu(false);
      }, 0);
    });

    panel.addEventListener('click', function (event) {
      const link = event.target.closest && event.target.closest('a[href]');
      if (link && panel.contains(link)) closeMenu(false);
    });

    const phoneLayout = window.matchMedia('(max-width: 768px)');
    function onLayoutChange(event) {
      if (!event.matches) closeMenu(false);
    }
    if (phoneLayout.addEventListener) phoneLayout.addEventListener('change', onLayoutChange);
    else if (phoneLayout.addListener) phoneLayout.addListener(onLayoutChange);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeMenu, { once: true });
  else initializeMenu();
}());
