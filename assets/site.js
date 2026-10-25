/* Optional enhancements only. No essential content depends on this file. */
(() => {
  'use strict';

  const ANALYTICS_ID = 'G-KZL0QVQ6XC';
  const CONSENT_KEY = 'vektorium.analytics-consent.v1';
  let analyticsStarted = false;
  let analyticsScript = null;
  let consentBanner = null;
  let consentStatus = null;
  let privacySettingsButton = null;

  function readConsent() {
    try {
      const value = window.localStorage.getItem(CONSENT_KEY);
      return value === 'granted' || value === 'denied' ? value : null;
    } catch {
      return null;
    }
  }

  function saveConsent(value) {
    try {
      window.localStorage.setItem(CONSENT_KEY, value);
      return true;
    } catch {
      return false;
    }
  }

  function privacySignalPresent() {
    return navigator.globalPrivacyControl === true ||
      navigator.doNotTrack === '1' || window.doNotTrack === '1';
  }

  function productionHost() {
    return window.location.hostname === 'vektorium.io' ||
      window.location.hostname === 'www.vektorium.io';
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function safeReferrer() {
    try {
      return document.referrer ? new URL(document.referrer).origin : '';
    } catch {
      return '';
    }
  }

  function loadAnalytics() {
    // Preview deployments and local development must never send measurement.
    if (analyticsStarted || !productionHost() || privacySignalPresent()) return;
    analyticsStarted = true;
    window['ga-disable-' + ANALYTICS_ID] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied'
    });
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', ANALYTICS_ID, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // Do not pass query strings, fragment identifiers or full referrer URLs.
      page_location: window.location.origin + window.location.pathname,
      page_referrer: safeReferrer(),
      cookie_flags: 'SameSite=Lax;Secure'
    });
    analyticsScript = element('script');
    analyticsScript.async = true;
    analyticsScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + ANALYTICS_ID;
    analyticsScript.referrerPolicy = 'no-referrer';
    analyticsScript.setAttribute('data-vx-analytics', 'consented');
    analyticsScript.addEventListener('error', () => {
      window['ga-disable-' + ANALYTICS_ID] = true;
      if (consentStatus) {
        consentStatus.textContent = 'Analytics could not load. The website remains fully usable.';
      }
    });
    document.head.append(analyticsScript);
  }

  function clearAnalyticsCookies() {
    let accessibleCookies;
    try {
      accessibleCookies = document.cookie;
    } catch {
      // Cookie access may be unavailable in a restrictive browser context.
      return;
    }
    const names = accessibleCookies.split(';').map(part => part.trim().split('=')[0])
      .filter(name => /^_ga(?:_|$)/.test(name) || name === '_gid' || /^_gat(?:_|$)/.test(name));
    const domains = ['', window.location.hostname, '.' + window.location.hostname];
    if (productionHost()) domains.push('vektorium.io', '.vektorium.io');
    for (const name of names) {
      for (const domain of new Set(domains)) {
        try {
          document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax; Secure' +
            (domain ? '; Domain=' + domain : '');
        } catch {
          // Measurement remains disabled even when cookie writes are blocked.
        }
      }
    }
  }

  function denyAnalytics(reloadSafe) {
    window['ga-disable-' + ANALYTICS_ID] = true;
    clearAnalyticsCookies();
    if (analyticsScript) analyticsScript.remove();
    // Removing a script tag cannot unload executed code. After saving a
    // rejection, reload to remove the previously permitted third-party code.
    // If storage is unavailable, keep the disable flag for this page instead.
    if (analyticsStarted && reloadSafe) window.location.reload();
  }

  function closeConsentBanner() {
    if (!consentBanner) return;
    const hadFocus = consentBanner.contains(document.activeElement);
    consentBanner.hidden = true;
    if (hadFocus && privacySettingsButton) privacySettingsButton.focus({ preventScroll: true });
  }

  function chooseConsent(desired) {
    const value = desired === 'granted' && !privacySignalPresent() ? 'granted' : 'denied';
    const saved = saveConsent(value);
    if (value === 'granted') loadAnalytics();
    else denyAnalytics(saved);
    if (saved) closeConsentBanner();
    else if (consentStatus) {
      consentStatus.textContent = 'This choice applies to this page. Your browser did not allow the preference to be saved.';
    }
  }

  function showConsentBanner(moveFocus) {
    if (!consentBanner) {
      consentBanner = element('section', 'vx-consent-banner');
      consentBanner.setAttribute('data-vx-consent-banner', '');
      consentBanner.setAttribute('role', 'region');
      consentBanner.setAttribute('aria-labelledby', 'vx-consent-title');
      const title = element('h2', '', 'Your privacy, your choice');
      title.id = 'vx-consent-title';
      title.tabIndex = -1;
      consentBanner.append(title);
      consentBanner.append(element('p', '',
        'Optional Google Analytics is off unless you allow it. Choose Essential only to keep analytics off. The website works either way.'));
      if (privacySignalPresent()) {
        consentBanner.append(element('p', '',
          'Your browser sends a privacy preference. Analytics stays off while that preference is enabled.'));
      } else if (!productionHost()) {
        consentBanner.append(element('p', '',
          'This is a preview. Analytics never loads on preview or local addresses.'));
      }
      const policyParagraph = element('p');
      const policy = element('a', '', 'Read our Privacy Policy');
      policy.href = '/privacy-policy';
      policyParagraph.append(policy);
      consentBanner.append(policyParagraph);
      const actions = element('div', 'vx-consent-actions');
      const deny = element('button', 'vx-consent-button', 'Essential only');
      deny.type = 'button';
      deny.setAttribute('data-vx-consent', 'denied');
      deny.addEventListener('click', () => chooseConsent('denied'));
      const allow = element('button', 'vx-consent-button', 'Allow analytics');
      allow.type = 'button';
      allow.setAttribute('data-vx-consent', 'granted');
      allow.disabled = privacySignalPresent();
      allow.addEventListener('click', () => chooseConsent('granted'));
      actions.append(deny, allow);
      consentBanner.append(actions);
      consentStatus = element('p', 'vx-consent-status');
      consentStatus.setAttribute('role', 'status');
      consentStatus.setAttribute('aria-live', 'polite');
      consentBanner.append(consentStatus);
      document.body.append(consentBanner);
    }
    consentBanner.hidden = false;
    consentStatus.textContent = analyticsStarted
      ? 'Turning analytics off reloads this page to stop the loaded analytics script.'
      : 'You can change your choice using Privacy settings in the footer.';
    if (moveFocus) consentBanner.querySelector('h2').focus({ preventScroll: true });
  }

  function initializePrivacy() {
    window['ga-disable-' + ANALYTICS_ID] = true;
    privacySettingsButton = element('button', 'vx-privacy-settings', 'Privacy settings');
    privacySettingsButton.type = 'button';
    privacySettingsButton.setAttribute('data-vx-privacy-settings', '');
    privacySettingsButton.addEventListener('click', () => showConsentBanner(true));
    const footer = document.querySelector('.footer-bottom') || document.querySelector('footer') || document.body;
    footer.append(privacySettingsButton);
    const consent = readConsent();
    if (consent === 'granted' && !privacySignalPresent()) loadAnalytics();
    else {
      clearAnalyticsCookies();
      if (consent === null && !privacySignalPresent()) showConsentBanner(false);
    }
    window.addEventListener('storage', event => {
      // A clear() event has a null key. Only a new grant also present in
      // storage may enable analytics; removal or invalid values cannot.
      if (event.key !== CONSENT_KEY && event.key !== null) return;
      const updated = event.key === CONSENT_KEY && event.newValue === 'granted' && readConsent() === 'granted'
        ? 'granted' : event.newValue === 'denied' ? 'denied' : null;
      if (updated === 'granted' && !privacySignalPresent()) {
        loadAnalytics();
        closeConsentBanner();
        return;
      }
      const willReload = analyticsStarted;
      denyAnalytics(true);
      if (willReload) return;
      if (updated === null && !privacySignalPresent()) showConsentBanner(false);
      else closeConsentBanner();
    });
  }

  function initializeMenus() {
    for (const menu of document.querySelectorAll('details.vx-mobile-menu')) {
      menu.addEventListener('keydown', event => {
        if (event.key === 'Escape' && menu.open) {
          event.preventDefault();
          menu.open = false;
          menu.querySelector('summary').focus();
        }
      });
      menu.addEventListener('click', event => {
        if (event.target.closest('a')) menu.open = false;
      });
      menu.addEventListener('focusout', event => {
        if (menu.open && event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
      });
      document.addEventListener('click', event => {
        if (menu.open && !menu.contains(event.target)) menu.open = false;
      });
    }
  }

  function initializeCopyEmail() {
    const button = document.getElementById('copyBtn');
    const emailLink = document.querySelector('.email-link[href^="mailto:"]');
    if (!button || !emailLink) return;
    const address = emailLink.textContent.trim();
    const originalText = button.textContent;
    const status = element('span', 'vx-sr-only');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    button.parentElement.append(status);
    button.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(address);
        button.textContent = 'Copied';
        status.textContent = 'Email address copied to clipboard.';
        window.setTimeout(() => { button.textContent = originalText; }, 2500);
      } catch {
        button.textContent = 'Copy unavailable';
        status.textContent = 'Copy was unavailable. Use the email link or select and copy the address.';
        window.setTimeout(() => { button.textContent = originalText; }, 2500);
      }
    });
  }

  function initialize() {
    initializeMenus();
    initializeCopyEmail();
    initializePrivacy();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
