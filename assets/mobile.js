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

    function closeMenu(restoreFocus) {
      if (!menu.open) return;
      menu.open = false;
      if (restoreFocus) summary.focus({ preventScroll: true });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.defaultPrevented || !menu.open) return;
      closeMenu(true);
      event.preventDefault();
    });

    document.addEventListener('click', function (event) {
      // Do not steal focus from the control the visitor just clicked.
      if (!header.contains(event.target)) closeMenu(false);
    });

    header.addEventListener('focusout', function (event) {
      // This is a navigation disclosure, not a modal. Let Tab leave normally,
      // and close the panel so it cannot cover the newly focused page control.
      if (event.relatedTarget && !header.contains(event.relatedTarget)) closeMenu(false);
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
