/* Privacy controls only: the original site layout and effects are untouched.
 * The owner selected analytics-on by default with a visitor opt-out. That
 * default is not visitor consent. No Google tag runs on preview/local hosts.
 */
(() => {
  'use strict';

  const ANALYTICS_ID = 'G-KZL0QVQ6XC';
  const DISABLE_KEY = 'ga-disable-' + ANALYTICS_ID;
  // Keep the historical key/values so an existing opt-out is not lost.
  const PREFERENCE_KEY = 'vektorium.analytics-consent.v1';
  const INITIALIZED_KEY = '__vektoriumPrivacyControlsV1';
  if (window[INITIALIZED_KEY]) return;
  window[INITIALIZED_KEY] = true;
  window[DISABLE_KEY] = true;

  let pageChoice = 'off';
  let analyticsAttempted = false;
  let analyticsStopped = false;
  let analyticsScript = null;
  let loadFailed = false;
  let reloadRequested = false;
  let storageUnavailable = false;
  let statusMessage = '';
  let settingsButton;
  let privacyDialog;
  let currentState;
  let status;
  let onButton;
  let offButton;
  let title;
  let focusable = [];
  let fallbackInert = [];

  function productionHost() {
    return window.location.protocol === 'https:' &&
      (window.location.hostname === 'vektorium.io' || window.location.hostname === 'www.vektorium.io');
  }

  function privacySignalPresent() {
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' ||
      navigator.msDoNotTrack === '1' || window.doNotTrack === '1';
  }

  function readPreference() {
    try {
      const value = window.localStorage.getItem(PREFERENCE_KEY);
      return { readable: true, persistedOff: value === 'denied', value: value === null ? 'default' : value === 'granted' ? 'on' : 'off' };
    } catch {
      return { readable: false, value: 'off' };
    }
  }

  function savePreference(choice) {
    const value = choice === 'on' ? 'granted' : 'denied';
    try {
      window.localStorage.setItem(PREFERENCE_KEY, value);
      return window.localStorage.getItem(PREFERENCE_KEY) === value;
    } catch {
      return false;
    }
  }

  function canMeasure() {
    return pageChoice === 'on' && productionHost() && !privacySignalPresent() && !analyticsStopped;
  }

  function make(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function safeReferrer() {
    try {
      const url = new URL(document.referrer);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
    } catch {
      return '';
    }
  }

  function renderState() {
    if (!currentState) return;
    const active = canMeasure() && !window[DISABLE_KEY];
    currentState.textContent = active ? 'Analytics on' : 'Analytics off';
    onButton.setAttribute('aria-pressed', String(active));
    offButton.setAttribute('aria-pressed', String(!active));
    onButton.disabled = !productionHost() || privacySignalPresent() || reloadRequested;
    if (!productionHost()) {
      status.textContent = 'Analytics never loads on preview, local or non-HTTPS addresses.';
    } else if (privacySignalPresent()) {
      status.textContent = 'Your browser sends a Global Privacy Control or Do Not Track preference. Analytics stays off while that preference is enabled.';
    } else if (statusMessage) {
      status.textContent = statusMessage;
    } else if (storageUnavailable) {
      status.textContent = 'Your browser did not allow saved preferences to be read. Analytics stays off unless you turn it on for this page.';
    } else if (loadFailed) {
      status.textContent = 'Google Analytics could not load. The website remains fully usable.';
    } else {
      status.textContent = active
        ? 'Google Analytics is enabled on this page. Turning it off saves an opt-out and reloads this page to remove the loaded tag.'
        : 'Your saved opt-out is applied before the Google tag loads. The website works with analytics off.';
    }
  }

  function startAnalytics() {
    if (analyticsAttempted || !canMeasure()) return;
    analyticsAttempted = true;
    window[DISABLE_KEY] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      // A late caller must not enqueue new measurement after an opt-out.
      if (canMeasure() && !window[DISABLE_KEY]) window.dataLayer.push(arguments);
    };
    const configuration = {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: window.location.origin + window.location.pathname,
      page_referrer: safeReferrer(),
      cookie_domain: 'vektorium.io',
      cookie_path: '/',
      cookie_flags: 'SameSite=Lax;Secure'
    };
    // No Consent Mode grant is inferred from the owner's default, and no
    // analytics_storage=denied mode is used to send cookieless opt-out pings.
    window.gtag('set', {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: configuration.page_location,
      page_referrer: configuration.page_referrer
    });
    window.gtag('js', new Date());
    window.gtag('config', ANALYTICS_ID, configuration);
    const script = make('script');
    analyticsScript = script;
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + ANALYTICS_ID;
    script.referrerPolicy = 'no-referrer';
    script.setAttribute('data-vx-analytics', 'enabled');
    script.addEventListener('load', () => {
      // Removal does not cancel all in-flight execution. Never re-enable here.
      if (script !== analyticsScript || !canMeasure() || window[DISABLE_KEY]) return;
      renderState();
    });
    script.addEventListener('error', () => {
      if (script !== analyticsScript || !canMeasure()) return;
      window[DISABLE_KEY] = true;
      analyticsStopped = true;
      loadFailed = true;
      statusMessage = '';
      clearAnalyticsCookies();
      renderState();
    });
    document.head.append(script);
  }

  function clearAnalyticsCookies() {
    const names = new Set(['_ga', '_ga_KZL0QVQ6XC', '_gid', '_gat', '_gat_gtag_G_KZL0QVQ6XC']);
    try {
      for (const part of document.cookie.split(';')) {
        const name = part.trim().split('=')[0];
        if (/^_ga(?:_[A-Za-z0-9_-]+)?$/.test(name) || name === '_gid' || /^_gat(?:_[A-Za-z0-9_-]+)?$/.test(name)) names.add(name);
      }
    } catch {
      // Try the known GA names even when cookie reads are blocked.
    }
    const domains = new Set(['', window.location.hostname, '.' + window.location.hostname]);
    if (productionHost()) {
      domains.add('vektorium.io');
      domains.add('.vektorium.io');
    }
    const paths = new Set(['/']);
    let path = '';
    for (const segment of window.location.pathname.split('/').filter(Boolean)) {
      path += '/' + segment;
      if (!/[;\r\n]/.test(path)) {
        paths.add(path);
        paths.add(path + '/');
      }
    }
    for (const name of names) {
      for (const domain of domains) {
        for (const cookiePath of paths) {
          try {
            document.cookie = name + '=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=' + cookiePath +
              '; SameSite=Lax; Secure' + (domain ? '; Domain=' + domain : '');
          } catch {
            // The disable flag remains effective if the browser blocks cookies.
          }
        }
      }
    }
  }

  function requestReload() {
    if (reloadRequested) return;
    reloadRequested = true;
    renderState();
    try {
      window.location.reload();
    } catch {
      statusMessage = 'Analytics is off on this page. Your preference is saved, but the browser blocked reloading. Reload manually to remove the already-loaded tag.';
      renderState();
    }
  }

  function stopAnalytics(reloadSafe) {
    // Google's documented kill switch is set before any cleanup or reload.
    // It also blocks the already-loaded tag from setting cookies/sending data.
    window[DISABLE_KEY] = true;
    pageChoice = 'off';
    if (analyticsAttempted) analyticsStopped = true;
    clearAnalyticsCookies();
    if (analyticsScript) analyticsScript.remove();
    analyticsScript = null;
    // Removing a node cannot unload JS. A saved off choice permits a clean
    // reload; without storage, keep this page disabled and explain the limit.
    if (analyticsAttempted && reloadSafe) requestReload();
  }

  function chooseAnalytics(choice) {
    if (choice === 'off') {
      window[DISABLE_KEY] = true;
      pageChoice = 'off';
      const saved = savePreference('off');
      storageUnavailable = !saved;
      statusMessage = saved
        ? 'Analytics off. Your opt-out is saved for this browser. Data already sent to Google is not deleted.'
        : 'Analytics is off on this page, but your browser did not allow the opt-out to be saved. It may be on again after navigation or reload. The already-loaded tag cannot be unloaded without reloading.';
      stopAnalytics(saved);
      renderState();
      return;
    }
    if (!productionHost() || privacySignalPresent() || reloadRequested) {
      renderState();
      return;
    }
    const saved = savePreference('on');
    storageUnavailable = !saved;
    if (analyticsStopped) {
      // Do not replay a cancelled/partly-executed tag or duplicate page views.
      statusMessage = saved
        ? 'Analytics on is saved. Reloading to apply it in a clean page.'
        : 'Analytics stays off on this page. Your browser did not allow Analytics on to be saved; a clean reload is needed to restart a stopped tag.';
      if (saved) requestReload();
    } else {
      pageChoice = 'on';
      statusMessage = saved
        ? 'Analytics on. This browser preference is saved.'
        : 'Analytics is on for this page only. Your browser did not allow the preference to be saved.';
      startAnalytics();
    }
    renderState();
  }

  function restoreFocus() {
    for (const entry of fallbackInert) entry.node.inert = entry.inert;
    fallbackInert = [];
    settingsButton.setAttribute('aria-expanded', 'false');
    settingsButton.focus({ preventScroll: true });
  }

  function closeSettings() {
    if (!privacyDialog.hasAttribute('open')) return;
    if (typeof privacyDialog.close === 'function') privacyDialog.close();
    else privacyDialog.removeAttribute('open');
    restoreFocus();
  }

  function openSettings() {
    checkForRevocation();
    renderState();
    if (privacyDialog.hasAttribute('open')) return;
    if (typeof privacyDialog.showModal === 'function') privacyDialog.showModal();
    else {
      privacyDialog.setAttribute('open', '');
      for (const node of document.body.children) {
        if (node === privacyDialog) continue;
        fallbackInert.push({ node, inert: node.inert });
        node.inert = true;
      }
    }
    settingsButton.setAttribute('aria-expanded', 'true');
    title.focus({ preventScroll: true });
  }

  function createControls() {
    settingsButton = make('button', 'vx-privacy-settings', 'Privacy settings');
    settingsButton.type = 'button';
    settingsButton.setAttribute('data-vx-privacy-settings', '');
    settingsButton.setAttribute('aria-haspopup', 'dialog');
    settingsButton.setAttribute('aria-controls', 'vx-privacy-dialog');
    settingsButton.setAttribute('aria-expanded', 'false');
    settingsButton.addEventListener('click', openSettings);
    const footer = document.querySelector('.footer-bottom') || document.querySelector('footer') || document.body;
    footer.append(settingsButton);

    privacyDialog = make('dialog', 'vx-privacy-dialog');
    privacyDialog.id = 'vx-privacy-dialog';
    privacyDialog.setAttribute('data-vx-privacy-dialog', '');
    privacyDialog.setAttribute('role', 'dialog');
    privacyDialog.setAttribute('aria-modal', 'true');
    privacyDialog.setAttribute('aria-labelledby', 'vx-privacy-title');
    privacyDialog.setAttribute('aria-describedby', 'vx-privacy-description');
    const heading = make('div', 'vx-privacy-heading');
    title = make('h2', 'vx-privacy-title', 'Privacy settings');
    title.id = 'vx-privacy-title';
    title.tabIndex = -1;
    const close = make('button', 'vx-privacy-close', 'Close');
    close.type = 'button';
    close.setAttribute('data-vx-privacy-close', '');
    close.setAttribute('aria-label', 'Close privacy settings');
    close.addEventListener('click', closeSettings);
    heading.append(title, close);
    privacyDialog.append(heading);
    const description = make('p', 'vx-privacy-copy',
      'This website uses Google Analytics by default to understand visits. You can turn analytics off here. The website works either way.');
    description.id = 'vx-privacy-description';
    privacyDialog.append(description);
    privacyDialog.append(make('p', 'vx-privacy-copy',
      'When enabled, your browser connects to Google. Analytics can include page and referral information, browser/device details and pseudonymous identifiers; Google also receives your IP address in the connection.'));
    currentState = make('p', 'vx-privacy-current');
    currentState.setAttribute('role', 'status');
    currentState.setAttribute('aria-live', 'polite');
    privacyDialog.append(currentState);
    const policyParagraph = make('p', 'vx-privacy-copy');
    const policy = make('a', 'vx-privacy-link', 'Read our Privacy Policy');
    policy.href = '/privacy-policy';
    policyParagraph.append(policy);
    privacyDialog.append(policyParagraph);
    const actions = make('div', 'vx-privacy-actions');
    offButton = make('button', 'vx-privacy-button', 'Analytics off');
    offButton.type = 'button';
    offButton.setAttribute('data-vx-analytics-choice', 'off');
    offButton.addEventListener('click', () => chooseAnalytics('off'));
    onButton = make('button', 'vx-privacy-button', 'Analytics on');
    onButton.type = 'button';
    onButton.setAttribute('data-vx-analytics-choice', 'on');
    onButton.addEventListener('click', () => chooseAnalytics('on'));
    actions.append(offButton, onButton);
    privacyDialog.append(actions);
    status = make('p', 'vx-privacy-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    privacyDialog.append(status);
    privacyDialog.append(make('p', 'vx-privacy-copy',
      'Switching off stops future Analytics collection for this site and attempts to clear accessible Analytics cookies. It does not delete information already sent. Preferences are specific to this browser and website origin.'));
    focusable = [close, policy, offButton, onButton];
    privacyDialog.addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
    privacyDialog.addEventListener('close', restoreFocus);
    privacyDialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeSettings(); return; }
      if (event.key !== 'Tab') return;
      const available = focusable.filter(node => !node.disabled);
      const first = available[0];
      const last = available[available.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === title)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    document.addEventListener('focusin', event => {
      if (fallbackInert.length && privacyDialog.hasAttribute('open') && !privacyDialog.contains(event.target)) title.focus({ preventScroll: true });
    });
    document.body.append(privacyDialog);
  }

  function checkForRevocation() {
    const preference = readPreference();
    if (privacySignalPresent() || !productionHost() || !preference.readable || preference.value === 'off') {
      storageUnavailable = !preference.readable;
      if (!preference.readable) statusMessage = 'Saved preferences cannot be read. Analytics is off on this page; your browser may not retain this choice.';
      stopAnalytics(preference.readable && preference.value === 'off' || privacySignalPresent());
      renderState();
    }
  }

  function synchronizePreference(event) {
    if (event.key !== PREFERENCE_KEY && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
    } catch {
      // Treat an unreadable relevant preference as an off signal.
    }
    const preference = readPreference();
    if (event.key === PREFERENCE_KEY && event.newValue === 'granted' && preference.readable && preference.value === 'on') {
      storageUnavailable = false;
      if (!productionHost() || privacySignalPresent()) { stopAnalytics(false); renderState(); return; }
      if (analyticsStopped) {
        statusMessage = 'Analytics on was saved in another tab. Reloading to apply it in a clean page.';
        requestReload();
      } else {
        pageChoice = 'on';
        statusMessage = 'Analytics on was saved in another tab.';
        startAnalytics();
        renderState();
      }
      return;
    }
    // Removal/clear is not a new permission. Persist off before a reload so
    // the owner's default cannot restart tracking in this already-open tab.
    window[DISABLE_KEY] = true;
    const saved = preference.readable && preference.persistedOff || savePreference('off');
    storageUnavailable = !saved;
    statusMessage = saved
      ? 'Analytics off was applied from another tab.'
      : 'Analytics is off on this page after a change in another tab, but the opt-out could not be saved. It may be on again after navigation or reload.';
    stopAnalytics(saved);
    renderState();
  }

  function initialize() {
    const preference = readPreference();
    storageUnavailable = !preference.readable;
    pageChoice = preference.readable && preference.value !== 'off' ? 'on' : 'off';
    createControls();
    if (canMeasure()) startAnalytics();
    else { window[DISABLE_KEY] = true; clearAnalyticsCookies(); }
    renderState();
    window.addEventListener('storage', synchronizePreference);
    window.addEventListener('pageshow', checkForRevocation);
    window.addEventListener('focus', checkForRevocation);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForRevocation();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
