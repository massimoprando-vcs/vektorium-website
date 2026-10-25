#!/usr/bin/env node
/**
 * Dependency-free behavioral tests for assets/site.js.
 * Run: node scripts/test_site.mjs
 *
 * The website source is read, not modified. DOM, cookies, localStorage,
 * clipboard and timers exist only in memory. Appended scripts are recorded
 * but never fetched or executed. These tests do not replace browser QA.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/site.js', import.meta.url), 'utf8');
const CONSENT_KEY = 'vektorium.analytics-consent.v1';
const ANALYTICS_ID = 'G-KZL0QVQ6XC';
const DISABLE_KEY = 'ga-disable-' + ANALYTICS_ID;

function fixture(options = {}) {
  let document;
  let head;
  const scriptLoads = [];
  const cookieWrites = [];
  const clipboardWrites = [];
  const timers = [];
  const storage = options.storage || new Map();
  let reloads = 0;
  if (options.consent !== undefined) storage.set(CONSENT_KEY, options.consent);

  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler, configuration = {}) {
      const handlers = this.listeners.get(type) || [];
      handlers.push({ handler, once: configuration.once === true });
      this.listeners.set(type, handlers);
    }
    fire(type, event = {}) {
      const handlers = [...(this.listeners.get(type) || [])];
      const results = [];
      for (const entry of handlers) {
        results.push(entry.handler({ target: this, ...event }));
        if (entry.once) this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== entry));
      }
      return Promise.all(results);
    }
  }

  class Element extends Events {
    constructor(tagName) {
      super();
      this.tagName = tagName;
      this.children = [];
      this.attributes = {};
      this.className = '';
      this.textContent = '';
      this.hidden = false;
      this.open = false;
      this.removed = false;
      this.style = new Proxy({}, { set() { throw new Error('Inline style writes are forbidden'); } });
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
        if (this === head && node.tagName === 'script') scriptLoads.push(node);
      }
    }
    setAttribute(name, value) {
      assert.notEqual(name.toLowerCase(), 'style', 'inline styles are forbidden');
      assert.equal(/^on/i.test(name), false, 'inline handlers are forbidden');
      this.attributes[name] = value;
    }
    contains(target) { return this === target || this.children.some(node => node.contains(target)); }
    querySelector(selector) { return descendants(this).find(node => node.tagName === selector) || null; }
    closest(selector) {
      if (this.tagName === selector) return this;
      return this.parentElement?.closest(selector) || null;
    }
    focus() { document.activeElement = this; }
    remove() {
      this.removed = true;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    }
    set innerHTML(_value) { throw new Error('innerHTML is forbidden'); }
    insertAdjacentHTML() { throw new Error('insertAdjacentHTML is forbidden'); }
  }

  function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }

  head = new Element('head');
  const body = new Element('body');
  const footer = new Element('footer');
  const menu = new Element('details');
  const summary = new Element('summary');
  const menuLink = new Element('a');
  menu.className = 'vx-mobile-menu';
  menu.append(summary, menuLink);
  if (options.menu !== false) body.append(menu);
  if (options.footer !== false) body.append(footer);

  const emailGroup = new Element('div');
  const emailLink = new Element('a');
  const copyButton = new Element('button');
  emailLink.className = 'email-link';
  emailLink.href = 'mailto:massimo.prando@vektorium.io';
  emailLink.textContent = 'massimo.prando@vektorium.io';
  copyButton.id = 'copyBtn';
  copyButton.textContent = 'Copy Email';
  emailGroup.append(emailLink, copyButton);
  if (options.contact) body.append(emailGroup);

  document = new Events();
  Object.assign(document, {
    head, body,
    readyState: options.readyState || 'complete',
    referrer: options.referrer === undefined ? 'https://example.org/private-path?sensitive=yes#secret' : options.referrer,
    activeElement: body,
    createElement: tag => new Element(tag),
    getElementById: id => [head, body, ...descendants(head), ...descendants(body)].find(node => node.id === id) || null,
    querySelector: selector => {
      if (selector === '.footer-bottom' || selector === 'footer') return options.footer === false ? null : footer;
      if (selector === '.email-link[href^="mailto:"]') return options.contact ? emailLink : null;
      throw new Error('Unsupported document selector in fixture: ' + selector);
    },
    querySelectorAll: selector => {
      assert.equal(selector, 'details.vx-mobile-menu');
      return options.menu === false ? [] : [menu];
    }
  });
  Object.defineProperty(document, 'cookie', {
    get() {
      if (options.cookieReadBlocked) throw new Error('Cookie reads blocked');
      return options.cookies || '';
    },
    set(value) {
      if (options.cookieWriteBlocked) throw new Error('Cookie writes blocked');
      cookieWrites.push(value);
    }
  });

  const window = new Events();
  const hostname = options.hostname || 'vektorium.io';
  const memoryStorage = {
    getItem(key) {
      if (options.storageReadBlocked) throw new Error('Storage reads blocked');
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.storageWriteBlocked) throw new Error('Storage writes blocked');
      storage.set(key, value);
    }
  };
  Object.assign(window, {
    location: {
      hostname, origin: 'https://' + hostname, pathname: '/contact',
      search: '?sensitive=yes', hash: '#secret', reload: () => { reloads += 1; }
    },
    localStorage: memoryStorage,
    doNotTrack: options.windowDNT,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    fetch() { throw new Error('Network access is forbidden in these tests'); }
  });
  const navigator = {
    globalPrivacyControl: options.gpc,
    doNotTrack: options.dnt,
    sendBeacon() { throw new Error('Network access is forbidden in these tests'); },
    clipboard: options.clipboardUnavailable ? undefined : {
      async writeText(value) {
        if (options.clipboardRejected) throw new Error('Clipboard permission denied');
        clipboardWrites.push(value);
      }
    }
  };
  vm.runInNewContext(source, { window, document, navigator, URL, Set, Date }, {
    filename: 'assets/site.js', timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false }
  });

  const nodes = () => [head, body, ...descendants(head), ...descendants(body)];
  const select = (name, value) => nodes().find(node => node.attributes[name] === value);
  return {
    window, document, navigator, storage, scriptLoads, cookieWrites, clipboardWrites,
    menu, summary, menuLink, copyButton, emailGroup, body, footer, nodes, timers,
    reloads: () => reloads,
    banner: () => select('data-vx-consent-banner', ''),
    button: value => select('data-vx-consent', value),
    privacyButton: () => select('data-vx-privacy-settings', ''),
    consentStatus: () => nodes().find(node => node.className === 'vx-consent-status'),
    async choose(value) {
      const button = select('data-vx-consent', value);
      assert(button, 'Expected consent button: ' + value);
      assert.notEqual(button.disabled, true, 'Consent button is disabled');
      return button.fire('click');
    },
    settings: () => select('data-vx-privacy-settings', '').fire('click'),
    otherTabChoice(value, eventKey = CONSENT_KEY) {
      if (value === null) storage.delete(CONSENT_KEY);
      else storage.set(CONSENT_KEY, value);
      return window.fire('storage', { key: eventKey, newValue: value });
    },
    runTimers() { for (const timer of timers.splice(0)) timer.callback(); }
  };
}

test('no consent: no analytics script, no persisted choice, accessible choice controls', () => {
  const f = fixture();
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.window[DISABLE_KEY], true);
  assert.equal(f.storage.size, 0);
  assert(f.banner());
  assert.equal(f.button('denied').textContent, 'Essential only');
  assert.equal(f.button('granted').textContent, 'Allow analytics');
  assert.equal(f.button('denied').className, f.button('granted').className);
  assert(f.nodes().some(node => node.href === '/privacy-policy'));
});

test('explicit rejection is durable and never loads analytics', async () => {
  const f = fixture();
  await f.choose('denied');
  assert.equal(f.storage.get(CONSENT_KEY), 'denied');
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.banner().hidden, true);
});

test('explicit production permission loads only the expected script and minimizes configured data', async () => {
  const f = fixture();
  await f.choose('granted');
  assert.equal(f.scriptLoads.length, 1);
  assert.equal(f.scriptLoads[0].src, 'https://www.googletagmanager.com/gtag/js?id=' + ANALYTICS_ID);
  assert.equal(f.scriptLoads[0].referrerPolicy, 'no-referrer');
  assert.equal(f.scriptLoads[0].attributes['data-vx-analytics'], 'consented');
  assert.equal(f.window[DISABLE_KEY], false);
  const config = f.window.dataLayer.find(command => command[0] === 'config')[2];
  assert.equal(config.page_location, 'https://vektorium.io/contact');
  assert.equal(config.page_referrer, 'https://example.org');
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.cookie_flags, 'SameSite=Lax;Secure');
  const defaults = f.window.dataLayer.find(command => command[0] === 'consent' && command[1] === 'default')[2];
  for (const type of ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']) assert.equal(defaults[type], 'denied');
});

test('only exact production hosts honor remembered permission', () => {
  for (const hostname of ['vektorium.io', 'www.vektorium.io']) {
    assert.equal(fixture({ hostname, consent: 'granted' }).scriptLoads.length, 1, hostname);
  }
  for (const hostname of ['preview.vercel.app', 'localhost', '127.0.0.1', 'vektorium.io.example.org', 'www.vektorium.io.example.org', 'demo.vektorium.io']) {
    const f = fixture({ hostname, consent: 'granted' });
    assert.equal(f.scriptLoads.length, 0, hostname);
    assert.equal(f.window[DISABLE_KEY], true, hostname);
  }
});

test('explicit permission on a preview still cannot start analytics', async () => {
  const f = fixture({ hostname: 'preview.vercel.app' });
  await f.choose('granted');
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.storage.get(CONSENT_KEY), 'granted');
});

test('GPC and both DNT sources override stored permission and disable the allow control', async () => {
  for (const signal of [{ gpc: true }, { dnt: '1' }, { windowDNT: '1' }]) {
    const f = fixture({ ...signal, consent: 'granted' });
    assert.equal(f.scriptLoads.length, 0);
    assert.equal(f.window[DISABLE_KEY], true);
    await f.settings();
    assert.equal(f.button('granted').disabled, true);
  }
});

test('rejection clears only accessible GA cookies with secure root-path deletion', () => {
  const f = fixture({ consent: 'denied', cookies: '_ga=x; _ga_KZL0QVQ6XC=x; _gid=x; _gat=x; _gat_test=x; session=keep; _gallery=keep' });
  const names = new Set(f.cookieWrites.map(value => value.split('=')[0]));
  assert.deepEqual([...names].sort(), ['_ga', '_ga_KZL0QVQ6XC', '_gat', '_gat_test', '_gid']);
  assert(f.cookieWrites.every(value => value.includes('Max-Age=0; Path=/; SameSite=Lax; Secure')));
});

test('local revocation disables GA, removes its tag, saves rejection and reloads', async () => {
  const f = fixture({ consent: 'granted', cookies: '_ga=x' });
  await f.settings();
  await f.choose('denied');
  assert.equal(f.window[DISABLE_KEY], true);
  assert.equal(f.storage.get(CONSENT_KEY), 'denied');
  assert(f.scriptLoads[0].removed);
  assert.equal(f.reloads(), 1);
  assert(f.cookieWrites.length > 0);
});

test('two same-origin tabs both stop after one tab durably revokes consent', async () => {
  const storage = new Map([[CONSENT_KEY, 'granted']]);
  const first = fixture({ storage });
  const second = fixture({ storage, cookies: '_ga=x; session=keep' });
  await first.settings();
  await first.choose('denied');
  await second.window.fire('storage', { key: CONSENT_KEY, newValue: 'denied' });
  for (const f of [first, second]) {
    assert.equal(f.window[DISABLE_KEY], true);
    assert.equal(f.reloads(), 1);
    assert(f.scriptLoads[0].removed);
  }
  assert(second.cookieWrites.every(value => value.startsWith('_ga=')));
  const reloaded = fixture({ storage });
  assert.equal(reloaded.scriptLoads.length, 0);
  assert.equal(reloaded.reloads(), 0);
});

test('other-tab key removal and clear() stop active measurement', async () => {
  for (const eventKey of [CONSENT_KEY, null]) {
    const f = fixture({ consent: 'granted' });
    await f.otherTabChoice(null, eventKey);
    assert.equal(f.window[DISABLE_KEY], true);
    assert.equal(f.reloads(), 1);
  }
});

test('other-tab invalid preferences stop active measurement', async () => {
  const f = fixture({ consent: 'granted' });
  await f.otherTabChoice('invalid');
  assert.equal(f.window[DISABLE_KEY], true);
  assert.equal(f.reloads(), 1);
});

test('other-tab saved grant can start analytics exactly once', async () => {
  const f = fixture({ consent: 'denied' });
  await f.otherTabChoice('granted');
  await f.otherTabChoice('granted');
  assert.equal(f.scriptLoads.length, 1);
});

test('storage event payload alone cannot grant permission', async () => {
  const f = fixture({ consent: 'denied' });
  await f.window.fire('storage', { key: CONSENT_KEY, newValue: 'granted' });
  assert.equal(f.scriptLoads.length, 0);
});

test('other-tab grants still obey production-host, GPC and DNT gates', async () => {
  for (const options of [{ hostname: 'preview.vercel.app' }, { gpc: true }, { dnt: '1' }, { windowDNT: '1' }]) {
    const f = fixture({ ...options, consent: 'denied' });
    await f.otherTabChoice('granted');
    assert.equal(f.scriptLoads.length, 0);
  }
});

test('unrelated storage changes do not alter consent', async () => {
  const f = fixture();
  await f.window.fire('storage', { key: 'unrelated', newValue: 'granted' });
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.storage.size, 0);
});

test('repeated denial/removal while already off cannot cause a reload loop', async () => {
  const f = fixture({ consent: 'denied' });
  await f.otherTabChoice('denied');
  await f.otherTabChoice(null);
  await f.otherTabChoice(null, null);
  assert.equal(f.reloads(), 0);
  assert.equal(f.scriptLoads.length, 0);
});

test('blocked storage reads default to off; blocked writes keep the limitation visible', async () => {
  const f = fixture({ consent: 'granted', storageReadBlocked: true, storageWriteBlocked: true });
  assert.equal(f.scriptLoads.length, 0);
  await f.choose('denied');
  assert.equal(f.banner().hidden, false);
  assert.match(f.consentStatus().textContent, /preference to be saved/);
  assert.equal(f.reloads(), 0);
});

test('storage-blocked revocation disables the current page without reloading into the old grant', async () => {
  const f = fixture({ consent: 'granted', storageWriteBlocked: true });
  await f.settings();
  await f.choose('denied');
  assert.equal(f.window[DISABLE_KEY], true);
  assert.equal(f.storage.get(CONSENT_KEY), 'granted');
  assert.equal(f.reloads(), 0);
  assert(f.scriptLoads[0].removed);
  assert.match(f.consentStatus().textContent, /applies to this page/);
});

test('blocked cookie reads or writes do not break initialization', () => {
  for (const options of [{ cookieReadBlocked: true }, { cookieWriteBlocked: true, cookies: '_ga=x' }]) {
    const f = fixture({ ...options, consent: 'denied' });
    assert(f.privacyButton());
    assert.equal(f.scriptLoads.length, 0);
  }
});

test('failed analytics load disables measurement and preserves a usable interface', async () => {
  const f = fixture();
  await f.choose('granted');
  await f.scriptLoads[0].fire('error');
  assert.equal(f.window[DISABLE_KEY], true);
  assert.match(f.consentStatus().textContent, /remains fully usable/);
  assert(f.privacyButton());
});

test('an invalid referrer is omitted instead of throwing or sending it', () => {
  const f = fixture({ consent: 'granted', referrer: 'not a URL' });
  const config = f.window.dataLayer.find(command => command[0] === 'config')[2];
  assert.equal(config.page_referrer, '');
});

test('privacy settings focus the heading and choosing returns focus to the footer control', async () => {
  const f = fixture({ consent: 'denied' });
  await f.settings();
  assert.equal(f.document.activeElement.id, 'vx-consent-title');
  await f.choose('denied');
  assert.equal(f.document.activeElement, f.privacyButton());
  assert.equal(f.banner().hidden, true);
});

test('menu Escape closes the menu and returns focus to its summary', async () => {
  const f = fixture({ consent: 'denied' });
  let prevented = false;
  f.menu.open = true;
  await f.menu.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert(prevented);
  assert.equal(f.menu.open, false);
  assert.equal(f.document.activeElement, f.summary);
});

test('menu link activation closes the menu', async () => {
  const f = fixture({ consent: 'denied' });
  f.menu.open = true;
  await f.menu.fire('click', { target: f.menuLink });
  assert.equal(f.menu.open, false);
});

test('outside click closes the menu while an inside click does not', async () => {
  const f = fixture({ consent: 'denied' });
  f.menu.open = true;
  await f.document.fire('click', { target: f.summary });
  assert.equal(f.menu.open, true);
  await f.document.fire('click', { target: f.body });
  assert.equal(f.menu.open, false);
});

test('keyboard focus leaving the menu closes it without trapping focus', async () => {
  const f = fixture({ consent: 'denied' });
  f.menu.open = true;
  await f.menu.fire('focusout', { relatedTarget: f.menuLink });
  assert.equal(f.menu.open, true);
  await f.menu.fire('focusout', { relatedTarget: f.privacyButton() });
  assert.equal(f.menu.open, false);
});

test('contact copy writes the displayed email, announces success and restores the label', async () => {
  const f = fixture({ consent: 'denied', contact: true });
  await f.copyButton.fire('click');
  assert.deepEqual(f.clipboardWrites, ['massimo.prando@vektorium.io']);
  assert.equal(f.copyButton.textContent, 'Copied');
  assert(f.emailGroup.children.some(node => node.attributes.role === 'status' && /copied to clipboard/.test(node.textContent)));
  assert.equal(f.timers[0].delay, 2500);
  f.runTimers();
  assert.equal(f.copyButton.textContent, 'Copy Email');
});

test('unavailable or rejected clipboard access provides visible and announced feedback', async () => {
  for (const options of [{ clipboardUnavailable: true }, { clipboardRejected: true }]) {
    const f = fixture({ ...options, consent: 'denied', contact: true });
    await f.copyButton.fire('click');
    assert.equal(f.copyButton.textContent, 'Copy unavailable');
    assert(f.emailGroup.children.some(node => /Use the email link/.test(node.textContent)));
    assert.equal(f.clipboardWrites.length, 0);
    f.runTimers();
    assert.equal(f.copyButton.textContent, 'Copy Email');
  }
});

test('pages without optional contact/menu/footer elements initialize safely', () => {
  const f = fixture({ consent: 'denied', menu: false, footer: false });
  assert(f.privacyButton());
  assert.equal(f.privacyButton().parentElement, f.body);
  assert.equal(f.scriptLoads.length, 0);
});

test('loading documents defer initialization and initialize only once', async () => {
  const f = fixture({ consent: 'denied', readyState: 'loading' });
  assert.equal(f.privacyButton(), undefined);
  await f.document.fire('DOMContentLoaded');
  await f.document.fire('DOMContentLoaded');
  assert.equal(f.nodes().filter(node => node.attributes['data-vx-privacy-settings'] !== undefined).length, 1);
});
