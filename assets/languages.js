/* Native language links work without JavaScript; enhancements never redirect automatically. */
(function () {
  'use strict';
  function initializeLanguages() {
    const menus = [...document.querySelectorAll('.vx-language')];
    if (!menus.length) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 769px)');
    const mobileLayout = window.matchMedia('(max-width: 768px)');
    function close(menu, restore = false) {
      if (!menu.open) return;
      menu.open = false;
      if (restore) menu.querySelector('summary').focus({ preventScroll: true });
    }
    function cursorHover(active) {
      for (const id of ['cursorDot', 'cursorRing']) document.getElementById(id)?.classList.toggle('hovering', active);
    }
    for (const menu of menus) {
      const summary = menu.querySelector('summary');
      const panel = menu.querySelector('.vx-language-panel');
      let focusTimer;
      let pointerInside = false;
      menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        for (const other of menus) if (other !== menu) close(other);
        for (const other of document.querySelectorAll('.vx-mobile-menu[open], .vx-desktop-menu[open]')) other.open = false;
        document.dispatchEvent(new CustomEvent('vx:language-open'));
      });
      document.addEventListener('pointerdown', event => { pointerInside = menu.contains(event.target); if (!pointerInside) close(menu); });
      document.addEventListener('pointerup', () => { pointerInside = false; });
      document.addEventListener('pointercancel', () => { pointerInside = false; });
      document.addEventListener('focusin', event => { window.clearTimeout(focusTimer); if (!menu.contains(event.target)) close(menu); });
      menu.addEventListener('focusout', event => {
        window.clearTimeout(focusTimer);
        if (event.relatedTarget) { if (!menu.contains(event.relatedTarget)) close(menu); return; }
        focusTimer = window.setTimeout(() => { if (!pointerInside && !menu.contains(document.activeElement)) close(menu); }, 0);
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && menu.open) { event.preventDefault(); close(menu, true); }
      });
      panel.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!link || !panel.contains(link)) return;
        // Section IDs are shared across translations; preserve the reader's place.
        if (/^#[a-z0-9_.:-]+$/i.test(window.location.hash)) link.hash = window.location.hash;
        close(menu);
      });
      summary.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse' && finePointer.matches) cursorHover(true); });
      summary.addEventListener('pointerleave', () => cursorHover(false));
      menu.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || !finePointer.matches || reducedMotion.matches) return;
        const surface = summary.contains(event.target) ? summary : panel;
        const rect = surface.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        surface.style.setProperty('--vx-language-x', (event.clientX - rect.left) / rect.width * 100 + '%');
        surface.style.setProperty('--vx-language-y', (event.clientY - rect.top) / rect.height * 100 + '%');
      });
    }
    const closeMenus = () => { for (const menu of menus) close(menu); cursorHover(false); };
    if (mobileLayout.addEventListener) mobileLayout.addEventListener('change', closeMenus);
    else if (mobileLayout.addListener) mobileLayout.addListener(closeMenus);
    for (const menu of document.querySelectorAll('.vx-mobile-menu, .vx-desktop-menu')) menu.addEventListener('toggle', () => { if (menu.open) closeMenus(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeLanguages, { once: true });
  else initializeLanguages();
}());
