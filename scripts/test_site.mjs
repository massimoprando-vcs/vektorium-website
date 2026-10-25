#!/usr/bin/env node
/**
 * Dependency-free behavioral tests for the shared and desktop-effects scripts.
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

/* Desktop decoration has a separate fixture: media queries, visibility,
 * animation frames, Web Animations, intersections and WebGL are simulated.
 * No browser, GPU, network request, real timer or filesystem write is used. */
const desktopSource = readFileSync(new URL('../assets/desktop-effects.js', import.meta.url), 'utf8');
const sharedStyles = readFileSync(new URL('../assets/site.css', import.meta.url), 'utf8');
const desktopStyles = readFileSync(new URL('../assets/desktop-effects.css', import.meta.url), 'utf8');

test('desktop cursor enable selectors outrank ID-based fallback hiding', () => {
  // This source guard covers CSS cascade behavior that the DOM fixture does
  // not calculate. Each active selector must retain the ID plus state classes.
  for (const id of ['cursorDot', 'cursorRing']) {
    const activeSelector = `.vx-desktop-effects.vx-pointer-ready #${id}`;
    assert(desktopStyles.includes(activeSelector), `Missing ID-specific enable selector for ${id}`);
    const activeRule = [...desktopStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .find(rule => rule[1].split(',').some(selector => selector.trim() === activeSelector));
    assert(activeRule, `Missing enable rule for ${id}`);
    assert.match(activeRule[2], /display\s*:\s*block\s*;/);
    const fallbackRule = [...sharedStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .find(rule => rule[1].split(',').some(selector => selector.trim() === `#${id}`));
    assert(fallbackRule, `Missing static fallback rule for ${id}`);
    assert.match(fallbackRule[2], /display\s*:\s*none\s*;/);
    assert.doesNotMatch(fallbackRule[2], /!important/);
  }
});

test('shared no-JavaScript body styling explicitly restores the native cursor', () => {
  const bodyRule = [...sharedStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find(rule => rule[1].trim() === 'body');
  assert(bodyRule, 'Missing shared body fallback');
  assert.match(bodyRule[2], /cursor\s*:\s*auto\s*;/);
  assert.doesNotMatch(sharedStyles, /cursor\s*:\s*none/);
  assert.match(desktopStyles, /\.vx-desktop-effects\.vx-pointer-ready body[\s\S]*?cursor:\s*none/);
});

function desktopFixture(overrides = {}) {
  const configuration = {
    width: 1440, height: 900, fine: true, hover: true, reduced: false,
    forced: false, hidden: false, devicePixelRatio: 1, ...overrides
  };
  const animations = [];
  const observers = [];
  const contextCalls = [];
  const unsafeWrites = [];
  const frames = new Map();
  const timers = new Map();
  const media = new Map();
  let sequence = 0;
  let maximumPendingFrames = 0;
  let frameTime = 0;
  let document;

  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler, options = {}) {
      const handlers = this.listeners.get(type) || [];
      handlers.push({ handler, once: options.once === true });
      this.listeners.set(type, handlers);
    }
    removeEventListener(type, handler) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.handler !== handler));
    }
    emit(type, properties = {}) {
      const event = { target: this, defaultPrevented: false, ...properties };
      event.preventDefault ||= function () { this.defaultPrevented = true; };
      for (const entry of [...(this.listeners.get(type) || [])]) {
        entry.handler(event);
        if (entry.once) this.removeEventListener(type, entry.handler);
      }
      return event;
    }
    listenerCount(type) { return (this.listeners.get(type) || []).length; }
  }

  class Animation extends Events {
    constructor(element, keyframes, options) {
      super();
      this.element = element;
      this.keyframes = keyframes;
      this.options = options;
      this.currentTime = 0;
      this.playState = 'running';
      this.cancelled = false;
      this.keyframeUpdates = 0;
      this.effect = { setKeyframes: value => { this.keyframes = value; this.keyframeUpdates += 1; } };
      animations.push(this);
    }
    pause() { this.playState = 'paused'; }
    play() { this.playState = 'running'; }
    cancel() { this.cancelled = true; this.playState = 'idle'; }
    finish() { this.playState = 'finished'; this.emit('finish'); }
  }

  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  const matches = (node, selector) => selector.split(',').some(part => {
    const value = part.trim();
    if (value.startsWith('.')) return node.classList.contains(value.slice(1));
    if (value === '[id]') return Boolean(node.id);
    if (value === '[data-count]') return node.dataset.count !== undefined;
    if (value === '[data-vx-ticker-copy]') return node.attributes['data-vx-ticker-copy'] !== undefined;
    return node.tagName === value;
  });

  class Element extends Events {
    constructor(tagName, className = '', id = '') {
      super();
      this.tagName = tagName;
      this.className = className;
      this.id = id;
      this.children = [];
      this.attributes = {};
      this.dataset = {};
      this.textContent = '';
      this.removed = false;
      this.scrollHeight = 6000;
      this.rect = { left: 100, top: 100, width: 200, height: 300 };
      const tokens = () => new Set(this.className.split(/\s+/).filter(Boolean));
      this.classList = {
        add: (...values) => { this.className = [...new Set([...tokens(), ...values])].join(' '); },
        remove: (...values) => { this.className = [...tokens()].filter(value => !values.includes(value)).join(' '); },
        contains: value => tokens().has(value),
        toggle: (value, force) => {
          const enabled = force === undefined ? !tokens().has(value) : Boolean(force);
          if (enabled) this.classList.add(value); else this.classList.remove(value);
          return enabled;
        }
      };
      const forbidden = operation => { unsafeWrites.push(operation); throw new Error(operation + ' is forbidden'); };
      Object.defineProperty(this, 'style', {
        get: () => new Proxy({ setProperty: () => forbidden('inline style') }, { set: () => forbidden('inline style') }),
        set: () => forbidden('inline style')
      });
      if (configuration.animateUnavailable) this.animate = undefined;
    }
    append(...nodes) {
      for (const node of nodes) {
        assert.notEqual(node.tagName, 'script', 'The effects layer must never append a script');
        node.parentElement = this;
        this.children.push(node);
      }
    }
    setAttribute(name, value) {
      if (name === 'style' || /^on/i.test(name)) {
        unsafeWrites.push(name);
        throw new Error('Inline attribute is forbidden');
      }
      this.attributes[name] = value;
      if (name === 'id') this.id = value;
    }
    removeAttribute(name) { delete this.attributes[name]; if (name === 'id') this.id = ''; }
    querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return matches(this, selector) ? this : this.parentElement?.closest(selector) || null; }
    contains(target) { return this === target || descendants(this).includes(target); }
    getBoundingClientRect() { return this.rect; }
    cloneNode(deep) {
      const copy = new Element(this.tagName, this.className, this.id);
      copy.attributes = { ...this.attributes };
      copy.dataset = { ...this.dataset };
      copy.textContent = this.textContent;
      if (deep) copy.append(...this.children.map(child => child.cloneNode(true)));
      return copy;
    }
    remove() {
      this.removed = true;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    }
    animate(keyframes, options) {
      if (configuration.animateThrows) throw new Error('Animation API unavailable');
      return new Animation(this, keyframes, options);
    }
    set innerHTML(_value) { unsafeWrites.push('innerHTML'); throw new Error('innerHTML is forbidden'); }
    insertAdjacentHTML() { unsafeWrites.push('insertAdjacentHTML'); throw new Error('HTML injection is forbidden'); }
  }

  const root = new Element('html');
  const body = new Element('body');
  root.append(body);
  const header = new Element('header', 'header');
  const headerParts = ['header-left', 'header-center', 'header-right'].map(name => new Element('div', name));
  header.append(...headerParts);
  const headerLink = new Element('a');
  headerParts[0].append(headerLink);
  body.append(header);
  const dot = new Element('div', 'cursor-dot', 'cursorDot');
  const ring = new Element('div', 'cursor-ring', 'cursorRing');
  const canvas = new Element('canvas', '', 'fluidCanvas');
  const wrapper = new Element('div', 'canvas-wrapper');
  wrapper.append(canvas);
  const indicator = new Element('div', 'scroll-indicator', 'scrollIndicator');
  indicator.textContent = 'SCROLL 000%';
  if (!configuration.noDecorations) body.append(dot, ring, wrapper, indicator);
  const hero = new Element('section', 'hero');
  const heroElements = ['hero-shield', 'hero-title', 'hero-tagline', 'hero-badge'].map(name => new Element('div', name));
  hero.append(...heroElements);
  body.append(hero);
  const reveal = new Element('section', 'reveal');
  reveal.textContent = 'Essential content remains readable';
  const counter = new Element('span', 'counter');
  counter.dataset.target = '14200';
  counter.textContent = '14,200';
  const vision = new Element('div', 'vision-text');
  vision.append(new Element('span', 'dim'), new Element('span', 'dim'));
  const card = new Element('div', 'product-card');
  const glow = new Element('div', 'product-card-glow');
  card.append(glow);
  body.append(reveal, counter, vision, card);
  const ticker = new Element('section', 'ticker');
  const track = new Element('ul', 'ticker-track', 'tickerTrack');
  const tickerOriginals = ['One', 'Two'].map((text, index) => {
    const item = new Element('li', 'ticker-item', 'ticker-' + index);
    const highlight = new Element('span', 'hl', 'ticker-highlight-' + index);
    item.textContent = 'VEKTORIUM is ';
    highlight.textContent = text;
    item.append(highlight);
    return item;
  });
  track.append(...tickerOriginals);
  ticker.append(track);
  if (!configuration.noDecorations) body.append(ticker);

  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLE_STRIP: 8,
    shaders: [], programs: [], buffers: [], deletedShaders: [], deletedPrograms: [], deletedBuffers: [],
    draws: [], uniforms: {}, viewports: [],
    createShader(type) { const value = { type, id: ++sequence }; this.shaders.push(value); return value; },
    shaderSource(shader, value) { shader.source = value; },
    compileShader() {},
    getShaderParameter() { return !configuration.shaderFailure; },
    createProgram() { const value = { id: ++sequence }; this.programs.push(value); return value; },
    attachShader() {}, linkProgram() {},
    getProgramParameter() { return !configuration.linkFailure; },
    useProgram() {},
    createBuffer() { const value = { id: ++sequence }; this.buffers.push(value); return value; },
    bindBuffer() {}, bufferData() {}, getAttribLocation() { return 0; },
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    getUniformLocation(_program, name) { return name; },
    viewport(...values) { this.viewports.push(values); },
    uniform1f(name, value) { this.uniforms[name] = value; },
    uniform2f(name, x, y) { this.uniforms[name] = [x, y]; },
    drawArrays() {
      if (configuration.drawFailure) throw new Error('Simulated renderer failure');
      this.draws.push({ frameTime, elapsed: this.uniforms.u_time });
    },
    deleteShader(value) { this.deletedShaders.push(value); },
    deleteProgram(value) { this.deletedPrograms.push(value); },
    deleteBuffer(value) { this.deletedBuffers.push(value); }
  };
  canvas.getContext = (type, attributes) => {
    contextCalls.push({ type, attributes });
    if (configuration.webglThrows) throw new Error('WebGL blocked');
    return configuration.webglUnavailable ? null : gl;
  };

  class Observer {
    constructor(callback, settings) { this.callback = callback; this.settings = settings; this.targets = new Set(); this.disconnected = false; observers.push(this); }
    observe(element) { this.targets.add(element); }
    unobserve(element) { this.targets.delete(element); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
    intersect(element, isIntersecting = true) { this.callback([{ target: element, isIntersecting }]); }
  }
  document = new Events();
  Object.assign(document, {
    documentElement: root, body,
    readyState: configuration.readyState || 'complete', hidden: configuration.hidden,
    activeElement: body,
    createElement: tag => new Element(tag),
    getElementById: id => [root, ...descendants(root)].find(node => node.id === id) || null,
    querySelector: selector => root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector)
  });
  const desktopQuery = '(min-width: 1025px) and (hover: hover) and (pointer: fine)';
  const reducedQuery = '(prefers-reduced-motion: reduce)';
  const forcedQuery = '(forced-colors: active)';
  const mediaMatches = query => {
    if (query === desktopQuery) return configuration.width >= 1025 && configuration.hover && configuration.fine;
    if (query === reducedQuery) return configuration.reduced;
    if (query === forcedQuery) return configuration.forced;
    throw new Error('Unexpected media query: ' + query);
  };
  const window = new Events();
  Object.assign(window, {
    innerWidth: configuration.width, innerHeight: configuration.height,
    devicePixelRatio: configuration.devicePixelRatio, scrollY: 0,
    matchMedia: configuration.noMediaAPI ? undefined : query => {
      if (!media.has(query)) {
        const item = new Events();
        item.matches = mediaMatches(query);
        media.set(query, item);
      }
      return media.get(query);
    },
    requestAnimationFrame(callback) {
      const id = ++sequence;
      frames.set(id, callback);
      maximumPendingFrames = Math.max(maximumPendingFrames, frames.size);
      return id;
    },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    IntersectionObserver: configuration.noObserverAPI ? undefined : Observer,
    fetch() { throw new Error('Network access is forbidden in these tests'); }
  });
  vm.runInNewContext(desktopSource, { window, document }, {
    filename: 'assets/desktop-effects.js', timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false }
  });

  return {
    configuration, root, body, window, document, dot, ring, canvas, indicator, header, headerParts, headerLink,
    heroElements, reveal, counter, vision, card, glow, ticker, track, tickerOriginals,
    animations, observers, gl, contextCalls, unsafeWrites, frames, timers,
    maximumPendingFrames: () => maximumPendingFrames,
    active: () => root.classList.contains('vx-desktop-effects'),
    tickerCopies: () => track.children.filter(node => node.attributes['data-vx-ticker-copy'] !== undefined),
    tickerButton: () => ticker.querySelector('.vx-ticker-toggle'),
    poseFor: element => animations.findLast(animation => animation.element === element && animation.options.duration === 1 && !animation.cancelled),
    runFrame(time) {
      frameTime = time;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      for (const timer of pending) timer.callback();
    },
    intersect(element) {
      const observer = observers.find(value => value.targets.has(element));
      assert(observer, 'Expected an active observer for ' + element.className);
      observer.intersect(element);
    },
    pointer(x = 200, y = 250, target = body, pointerType = 'mouse') {
      document.emit('pointermove', { clientX: x, clientY: y, target, pointerType });
    },
    visibility(hidden) { document.hidden = hidden; document.emit('visibilitychange'); },
    mode(changes) {
      Object.assign(configuration, changes);
      window.innerWidth = configuration.width;
      window.innerHeight = configuration.height;
      window.devicePixelRatio = configuration.devicePixelRatio;
      for (const [query, item] of media) {
        const matches = mediaMatches(query);
        if (item.matches !== matches) { item.matches = matches; item.emit('change', { matches }); }
      }
      window.emit('resize');
    }
  };
}

test('desktop effects require a wide viewport, fine hover pointer and no motion/color preference', () => {
  for (const settings of [{ width: 1024 }, { width: 390 }, { fine: false }, { hover: false }, { reduced: true }, { forced: true }]) {
    const f = desktopFixture(settings);
    assert.equal(f.active(), false, JSON.stringify(settings));
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.contextCalls.length, 0);
    assert.equal(f.tickerCopies().length, 0);
    assert.equal(f.animations.length, 0);
    assert.equal(f.document.listenerCount('pointermove'), 0);
    assert.equal(f.counter.textContent, '14,200');
  }
  assert.equal(desktopFixture({ width: 1025 }).active(), true);
});

test('desktop effects leave the page static when required media APIs are unavailable', () => {
  const f = desktopFixture({ noMediaAPI: true });
  assert.equal(f.active(), false);
  assert.equal(f.frames.size, 0);
  assert.equal(f.contextCalls.length, 0);
  assert.equal(f.counter.textContent, '14,200');
});

test('desktop GPU starts lazily on interaction, using the original shader and low-power attributes', () => {
  const f = desktopFixture();
  assert.equal(f.contextCalls.length, 0);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 15000);
  f.runFrame(0);
  assert.equal(f.frames.size, 0);
  f.pointer();
  assert.equal(f.contextCalls.length, 0, 'Compilation is deferred to the frame, not the input handler');
  f.runFrame(16.67);
  assert.equal(f.contextCalls.length, 1);
  assert.equal(f.contextCalls[0].attributes.powerPreference, 'low-power');
  assert.equal(f.contextCalls[0].attributes.antialias, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.gl.draws.length, 1);
  assert(f.root.classList.contains('vx-webgl-ready'));
  assert(f.gl.shaders.find(shader => shader.type === f.gl.FRAGMENT_SHADER).source.includes('for(int i=0;i<3;i++)'));
  assert(f.gl.shaders.find(shader => shader.type === f.gl.FRAGMENT_SHADER).source.includes('exp(-d*d*12.0)*0.4'));
});

test('desktop idle fallback requests GPU work only through the single frame scheduler', () => {
  const f = desktopFixture();
  f.runFrame(0);
  f.runTimers();
  assert.equal(f.contextCalls.length, 0);
  assert.equal(f.frames.size, 1);
  f.runFrame(15000);
  assert.equal(f.contextCalls.length, 1);
  assert.equal(f.maximumPendingFrames(), 1);
});

test('cursor poses retain 0.2/0.08 smoothing through WAAPI without inline styles or HTML', () => {
  const f = desktopFixture();
  f.pointer(100, 100);
  f.runFrame(0);
  f.pointer(200, 200, f.card);
  f.runFrame(1000 / 60);
  const dotTransform = f.poseFor(f.dot).keyframes[0].transform;
  const ringTransform = f.poseFor(f.ring).keyframes[0].transform;
  assert.match(dotTransform, /translate3d\(120px,120px,0\)/);
  assert.match(ringTransform, /translate3d\(108px,108px,0\)/);
  assert(f.root.classList.contains('vx-pointer-ready'));
  assert(f.dot.classList.contains('hovering'));
  assert(f.ring.classList.contains('hovering'));
  assert.match(f.poseFor(f.glow).keyframes[0].background, /circle at 50%/);
  assert.deepEqual(f.unsafeWrites, []);
});

test('cursor failure never hides the native pointer or makes essential content depend on animation', () => {
  for (const settings of [{ animateUnavailable: true }, { animateThrows: true }]) {
    const f = desktopFixture(settings);
    f.pointer();
    f.runFrame(0);
    assert.equal(f.root.classList.contains('vx-pointer-ready'), false);
    assert.equal(f.reveal.textContent, 'Essential content remains readable');
    assert.equal(f.counter.textContent, '14,200');
    assert.deepEqual(f.unsafeWrites, []);
  }
});

test('touch and keyboard interaction restore the native pointer immediately', () => {
  const f = desktopFixture();
  f.pointer();
  f.runFrame(0);
  assert(f.root.classList.contains('vx-pointer-ready'));
  f.pointer(200, 250, f.body, 'touch');
  assert.equal(f.root.classList.contains('vx-pointer-ready'), false);
  f.pointer();
  f.runFrame(40);
  f.document.emit('keydown', { key: 'Tab' });
  assert.equal(f.root.classList.contains('vx-pointer-ready'), false);
});

test('hidden tabs cancel frames and pause animations; visibility resumes without a stale cursor', () => {
  const f = desktopFixture();
  f.pointer();
  f.runFrame(0);
  const before = f.gl.draws.length;
  f.visibility(true);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert(f.root.classList.contains('vx-effects-paused'));
  assert.equal(f.root.classList.contains('vx-pointer-ready'), false);
  assert(f.animations.filter(animation => animation.options.duration > 1).every(animation => animation.playState === 'paused'));
  f.runFrame(10000);
  assert.equal(f.gl.draws.length, before);
  f.visibility(false);
  assert.equal(f.frames.size, 1);
  assert.equal(f.root.classList.contains('vx-effects-paused'), false);
  f.runFrame(10020);
  assert.equal(f.root.classList.contains('vx-pointer-ready'), false);
  f.runFrame(10060);
  assert.equal(f.gl.uniforms.u_mouseActive, 0);
  assert(f.animations.filter(animation => animation.options.duration > 1).every(animation => animation.playState === 'running'));
});

test('initially hidden tabs do not initialize effects until visible', () => {
  const f = desktopFixture({ hidden: true });
  assert.equal(f.active(), false);
  assert.equal(f.contextCalls.length, 0);
  assert.equal(f.animations.length, 0);
  assert.equal(f.frames.size, 0);
  f.visibility(false);
  assert(f.active());
  assert.equal(f.frames.size, 1);
});

test('desktop mode cleanup restores counters and releases frames, listeners, observers, animations and GPU resources', () => {
  const f = desktopFixture();
  f.pointer(200, 250, f.card);
  f.intersect(f.counter);
  f.runFrame(0);
  assert.notEqual(f.counter.textContent, '14,200');
  assert(f.gl.draws.length > 0);
  const oldAnimations = [...f.animations];
  f.mode({ width: 1024 });
  assert.equal(f.active(), false);
  assert.equal(f.root.classList.contains('vx-pointer-ready'), false);
  assert.equal(f.root.classList.contains('vx-webgl-ready'), false);
  assert.equal(f.counter.textContent, '14,200');
  assert.equal(f.track.children.length, f.tickerOriginals.length);
  assert.equal(f.tickerButton(), null);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.document.listenerCount('pointermove'), 0);
  assert.equal(f.document.listenerCount('keydown'), 0);
  assert.equal(f.window.listenerCount('resize'), 0);
  assert.equal(f.window.listenerCount('scroll'), 0);
  assert(f.observers.every(observer => observer.disconnected));
  assert(oldAnimations.every(animation => animation.cancelled));
  assert.equal(f.gl.deletedShaders.length, 2);
  assert.equal(f.gl.deletedPrograms.length, 1);
  assert.equal(f.gl.deletedBuffers.length, 1);
  assert.equal(f.canvas.width, 1);
  assert.equal(f.canvas.height, 1);
  assert.equal(f.indicator.textContent, 'SCROLL 000%');
});

test('changing reduced-motion or forced-colors preferences performs full cleanup immediately', () => {
  for (const change of [{ reduced: true }, { forced: true }]) {
    const f = desktopFixture();
    f.intersect(f.counter);
    assert.equal(f.counter.textContent, '0');
    f.mode(change);
    assert.equal(f.counter.textContent, '14,200');
    assert.equal(f.frames.size, 0);
    assert.equal(f.active(), false);
    assert.equal(f.tickerCopies().length, 0);
  }
});

test('returning to desktop does not duplicate ticker copies or event handlers', () => {
  const f = desktopFixture();
  for (let index = 0; index < 3; index += 1) {
    f.mode({ fine: false });
    assert.equal(f.track.children.length, 2);
    f.mode({ fine: true });
    assert.equal(f.track.children.length, 4);
    assert.equal(f.document.listenerCount('pointermove'), 1);
    assert.equal(f.window.listenerCount('resize'), 1);
    assert.equal(f.frames.size, 1);
  }
  assert.equal(f.maximumPendingFrames(), 1);
});

test('ticker copies are hidden from assistive technology, inert, and free of duplicate IDs', () => {
  const f = desktopFixture();
  assert.equal(f.tickerCopies().length, f.tickerOriginals.length);
  for (const copy of f.tickerCopies()) {
    assert.equal(copy.attributes['aria-hidden'], 'true');
    assert.equal(copy.inert, true);
    assert.equal(copy.id, '');
    assert.equal(copy.querySelectorAll('[id]').length, 0);
  }
  assert(f.tickerOriginals.every(item => item.id));
  assert.deepEqual(f.unsafeWrites, []);
});

test('ticker pause/resume control changes the actual pause class and pressed state', () => {
  const f = desktopFixture();
  const button = f.tickerButton();
  assert.equal(button.type, 'button');
  assert.equal(button.attributes['aria-pressed'], 'false');
  button.emit('click');
  assert(f.track.classList.contains('vx-ticker-paused'));
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(button.textContent, 'Resume highlights');
  button.emit('click');
  assert.equal(f.track.classList.contains('vx-ticker-paused'), false);
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.equal(button.textContent, 'Pause highlights');
});

test('rapid pointer, scroll and resize events share one outstanding animation frame', () => {
  const f = desktopFixture();
  for (let index = 0; index < 20; index += 1) {
    f.pointer(200 + index, 250 + index, f.card);
    f.window.emit('scroll');
    f.window.emit('resize');
  }
  assert.equal(f.frames.size, 1);
  f.runFrame(0);
  assert.equal(f.frames.size, 1);
  assert.equal(f.maximumPendingFrames(), 1);
});

test('GPU drawing is capped near 30fps and its HiDPI framebuffer is bounded to four megapixels', () => {
  const f = desktopFixture({ width: 8000, height: 4000, devicePixelRatio: 4 });
  f.pointer();
  f.runFrame(0);
  assert(f.canvas.width * f.canvas.height <= 4000000);
  assert(f.canvas.width > 0 && f.canvas.height > 0);
  const before = f.gl.draws.length;
  f.runFrame(10);
  f.runFrame(20);
  f.runFrame(30);
  assert.equal(f.gl.draws.length, before);
  f.runFrame(34);
  assert.equal(f.gl.draws.length, before + 1);
  f.mode({ width: 1920, height: 1080, devicePixelRatio: 2 });
  f.runFrame(70);
  assert(f.canvas.width * f.canvas.height <= 4000000);
  assert(f.canvas.width <= 1920 * 1.5);
});

test('WebGL denial or shader/link failure leaves safe fallback content and cleans partial resources', () => {
  for (const settings of [{ webglUnavailable: true }, { webglThrows: true }, { shaderFailure: true }, { linkFailure: true }]) {
    const f = desktopFixture(settings);
    f.pointer();
    f.runFrame(0);
    assert.equal(f.root.classList.contains('vx-webgl-ready'), false);
    assert.equal(f.gl.draws.length, 0);
    assert.equal(f.counter.textContent, '14,200');
    assert.equal(f.reveal.textContent, 'Essential content remains readable');
    assert.equal(f.gl.deletedShaders.length, f.gl.shaders.length);
    assert.equal(f.gl.deletedPrograms.length, f.gl.programs.length);
    const attempts = f.contextCalls.length;
    f.pointer(300, 300);
    f.runFrame(40);
    assert.equal(f.contextCalls.length, attempts, 'Failed contexts are not repeatedly retried on pointer movement');
  }
});

test('WebGL context loss removes readiness and restoration can safely rebuild the renderer', () => {
  const f = desktopFixture();
  f.pointer();
  f.runFrame(0);
  const draws = f.gl.draws.length;
  const event = f.canvas.emit('webglcontextlost');
  assert(event.defaultPrevented);
  assert.equal(f.root.classList.contains('vx-webgl-ready'), false);
  f.runFrame(40);
  assert.equal(f.gl.draws.length, draws);
  f.canvas.emit('webglcontextrestored');
  f.runFrame(80);
  assert(f.root.classList.contains('vx-webgl-ready'));
  assert.equal(f.contextCalls.length, 2);
  assert.equal(f.gl.draws.length, draws + 1);
});

test('a runtime renderer failure restores content, counters and the native pointer', () => {
  const f = desktopFixture({ drawFailure: true });
  f.intersect(f.counter);
  f.pointer();
  f.runFrame(0);
  assert.equal(f.active(), false);
  assert.equal(f.root.classList.contains('vx-pointer-ready'), false);
  assert.equal(f.counter.textContent, '14,200');
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.tickerCopies().length, 0);
  assert.equal(f.gl.deletedBuffers.length, 1);
});

test('counter animation preserves the displayed claim and ignores mismatched target metadata', () => {
  const f = desktopFixture();
  f.counter.dataset.target = '99999';
  f.intersect(f.counter);
  assert.equal(f.counter.textContent, '14,200');
  const valid = desktopFixture();
  valid.intersect(valid.counter);
  valid.runFrame(0);
  valid.runFrame(1000);
  assert.equal(valid.counter.textContent, '14,200');
});

test('intersection effects are progressive and paused entries wait until visibility resumes', () => {
  const f = desktopFixture();
  assert.equal(f.animations.filter(animation => animation.element === f.reveal).length, 0);
  assert.equal(f.reveal.textContent, 'Essential content remains readable');
  f.visibility(true);
  f.intersect(f.reveal);
  assert.equal(f.animations.filter(animation => animation.element === f.reveal).length, 0);
  f.visibility(false);
  const animation = f.animations.find(value => value.element === f.reveal);
  assert(animation);
  assert.equal(animation.options.duration, 800);
  animation.finish();
  assert(animation.cancelled);
});

test('header scroll fading does not keep a focused navigation link invisible', () => {
  const f = desktopFixture();
  f.window.scrollY = 1000;
  f.runFrame(0);
  assert(f.header.classList.contains('vx-header-faded'));
  assert.equal(f.poseFor(f.headerParts[0]).keyframes[0].opacity, 0);
  f.document.activeElement = f.headerLink;
  f.header.emit('focusin');
  f.runFrame(40);
  assert.equal(f.header.classList.contains('vx-header-faded'), false);
  assert.equal(f.poseFor(f.headerParts[0]).keyframes[0].opacity, 1);
});

test('missing decoration or IntersectionObserver APIs leave the main page usable', () => {
  for (const settings of [{ noDecorations: true }, { noObserverAPI: true }]) {
    const f = desktopFixture(settings);
    f.runFrame(0);
    assert.equal(f.counter.textContent, '14,200');
    assert.equal(f.reveal.textContent, 'Essential content remains readable');
    assert.deepEqual(f.unsafeWrites, []);
    f.mode({ reduced: true });
    assert.equal(f.frames.size, 0);
  }
});

test('desktop initialization waits for DOM readiness; pagehide cleans up and pageshow rebuilds once', () => {
  const f = desktopFixture({ readyState: 'loading' });
  assert.equal(f.active(), false);
  f.document.emit('DOMContentLoaded');
  f.document.emit('DOMContentLoaded');
  assert(f.active());
  assert.equal(f.document.listenerCount('visibilitychange'), 1);
  assert.equal(f.document.listenerCount('pointermove'), 1);
  f.pointer();
  f.runFrame(0);
  f.window.emit('pagehide');
  assert.equal(f.active(), false);
  assert.equal(f.frames.size, 0);
  assert.equal(f.track.children.length, 2);
  f.window.emit('pageshow');
  f.window.emit('pageshow');
  assert(f.active());
  assert.equal(f.track.children.length, 4);
  assert.equal(f.document.listenerCount('pointermove'), 1);
  assert.equal(f.maximumPendingFrames(), 1);
});
