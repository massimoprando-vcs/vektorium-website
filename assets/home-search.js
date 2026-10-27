import { prepareSearchIndex, rankSearch, searchExcerpt, searchTerms } from './search-engine.js';

const root = document.getElementById('vx-home-search');
if (root) {
  const toggle = document.getElementById('vx-search-toggle');
  const panel = document.getElementById('vx-search-panel');
  const input = document.getElementById('vx-search-input');
  const clear = document.getElementById('vx-search-clear');
  const closeButton = document.getElementById('vx-search-close');
  const status = document.getElementById('vx-search-status');
  const popular = document.getElementById('vx-search-popular');
  const results = document.getElementById('vx-search-results');
  const message = document.getElementById('vx-search-message');
  const retry = document.getElementById('vx-search-retry');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 769px)');
  let opened = false;
  let closeTimer;
  let inputTimer;
  let indexPromise;
  let indexState = 'idle';
  let pages = [];
  let composing = false;

  function cursorHover(active) {
    for (const id of ['cursorDot', 'cursorRing']) document.getElementById(id)?.classList.toggle('hovering', active);
  }

  function resultLink(page, query) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'vx-search-result';
    link.href = page.url;
    const top = document.createElement('span');
    top.className = 'vx-search-result-top';
    const title = document.createElement('span');
    title.className = 'vx-search-result-title';
    title.textContent = page.title;
    top.append(title);
    if (page.category) {
      const category = document.createElement('span');
      category.className = 'vx-search-category';
      category.textContent = page.category;
      top.append(category);
    }
    link.append(top);
    const excerpt = searchExcerpt(page, query);
    if (excerpt) {
      const description = document.createElement('span');
      description.className = 'vx-search-excerpt';
      description.textContent = excerpt;
      link.append(description);
    }
    item.append(link);
    return item;
  }

  function render() {
    if (!opened) return;
    const query = input.value.trim();
    clear.hidden = !input.value.length;
    results.replaceChildren();
    results.hidden = true;
    message.hidden = true;
    retry.hidden = true;
    popular.hidden = Boolean(query);
    if (!query) {
      status.textContent = 'Explore Vektorium';
      return;
    }
    if (query.length < 2) {
      status.textContent = 'Type at least 2 characters';
      return;
    }
    if (indexState === 'idle' || indexState === 'loading') {
      status.textContent = 'Searching the website…';
      return;
    }
    if (indexState === 'error') {
      status.textContent = 'Search is temporarily unavailable';
      message.textContent = 'Try again, or explore one of these pages.';
      message.hidden = false;
      retry.hidden = false;
      popular.hidden = false;
      return;
    }
    const matches = searchTerms(query).length ? rankSearch(pages, query, 20) : [];
    const visible = matches.slice(0, 6);
    if (!visible.length) {
      status.textContent = 'No matching pages';
      message.textContent = 'Try a broader term, such as architecture, SIEM or encryption.';
      message.hidden = false;
      return;
    }
    status.textContent = matches.length > 6 ? 'Top 6 results' : visible.length + (visible.length === 1 ? ' result' : ' results');
    const fragment = document.createDocumentFragment();
    visible.forEach(page => fragment.append(resultLink(page, query)));
    results.append(fragment);
    results.hidden = false;
  }

  function loadIndex() {
    if (indexState === 'ready') return Promise.resolve();
    if (indexPromise) return indexPromise;
    indexState = 'loading';
    render();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    // The URL is constant. Search text never leaves this page or enters storage.
    indexPromise = fetch('/assets/site-search-index.json', { credentials: 'same-origin', cache: 'no-cache', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Index request failed');
        return response.json();
      })
      .then(data => {
        const prepared = prepareSearchIndex(data);
        if (!prepared.length) throw new Error('Empty index');
        pages = prepared;
        indexState = 'ready';
      })
      .catch(() => { indexState = 'error'; })
      .finally(() => {
        window.clearTimeout(timeout);
        indexPromise = undefined;
        // A late response updates data only; it never reopens a dismissed panel.
        render();
      });
    return indexPromise;
  }

  function openSearch() {
    if (opened) return;
    window.clearTimeout(closeTimer);
    const mobileMenu = document.querySelector('.vx-mobile-menu');
    if (mobileMenu?.open) mobileMenu.open = false;
    opened = true;
    panel.hidden = false;
    panel.inert = false;
    toggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => { if (opened) root.classList.add('is-open'); });
    render();
    input.focus({ preventScroll: true });
    loadIndex();
  }

  function closeSearch(restoreFocus = false) {
    if (!opened) return;
    opened = false;
    window.clearTimeout(inputTimer);
    root.classList.remove('is-open');
    panel.inert = true;
    toggle.setAttribute('aria-expanded', 'false');
    cursorHover(false);
    if (restoreFocus) toggle.focus({ preventScroll: true });
    closeTimer = window.setTimeout(() => { if (!opened) panel.hidden = true; }, reducedMotion.matches ? 0 : 220);
  }

  function currentLinks() {
    if (!results.hidden) return [...results.querySelectorAll('a')];
    if (!popular.hidden) return [...popular.querySelectorAll('a')];
    return [];
  }

  toggle.addEventListener('click', () => opened ? closeSearch(true) : openSearch());
  closeButton.addEventListener('click', () => closeSearch(true));
  clear.addEventListener('click', () => {
    input.value = '';
    window.clearTimeout(inputTimer);
    render();
    input.focus({ preventScroll: true });
  });
  retry.addEventListener('click', () => {
    input.focus({ preventScroll: true });
    loadIndex();
  });
  function inputChanged() {
    clear.hidden = !input.value.length;
    window.clearTimeout(inputTimer);
    if (!composing) inputTimer = window.setTimeout(render, 110);
  }
  input.addEventListener('input', inputChanged);
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; inputChanged(); });
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      window.clearTimeout(inputTimer);
      render();
      if (input.value.trim().length >= 2 && !results.hidden) results.querySelector('a')?.click();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      window.clearTimeout(inputTimer);
      render();
      const links = currentLinks();
      if (links.length) {
        event.preventDefault();
        (event.key === 'ArrowDown' ? links[0] : links[links.length - 1]).focus();
      }
    }
  });
  panel.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || event.target === input) return;
    const links = currentLinks();
    const index = links.indexOf(event.target.closest('a'));
    if (index < 0) return;
    event.preventDefault();
    const next = index + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= links.length) input.focus({ preventScroll: true });
    else links[next].focus();
  });
  document.addEventListener('keydown', event => {
    if (opened && event.key === 'Escape' && !event.isComposing && !composing) {
      event.preventDefault();
      closeSearch(true);
    }
  });
  document.addEventListener('pointerdown', event => { if (opened && !root.contains(event.target)) closeSearch(); });
  root.addEventListener('focusout', () => {
    queueMicrotask(() => { if (opened && !root.contains(document.activeElement)) closeSearch(); });
  });
  document.querySelector('.vx-mobile-menu')?.addEventListener('toggle', event => {
    if (event.target.open) closeSearch();
  });
  root.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || !finePointer.matches || reducedMotion.matches) return;
    const rect = panel.hidden ? toggle.getBoundingClientRect() : panel.getBoundingClientRect();
    root.style.setProperty('--vx-search-x', ((event.clientX - rect.left) / rect.width * 100).toFixed(1) + '%');
    root.style.setProperty('--vx-search-y', ((event.clientY - rect.top) / rect.height * 100).toFixed(1) + '%');
  });
  root.addEventListener('pointerover', event => { if (finePointer.matches && event.target.closest('a,button')) cursorHover(true); });
  root.addEventListener('pointerout', event => { if (event.target.closest('a,button')) cursorHover(false); });
  toggle.disabled = false;
}
