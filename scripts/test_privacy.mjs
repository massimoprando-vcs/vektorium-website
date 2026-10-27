#!/usr/bin/env node
/** Dependency-free privacy regression tests. DOM, storage, cookies and reloads
 * are in-memory fixtures. Appended Google scripts are recorded but never
 * fetched/executed; no network or fixture-file writes occur in these tests.
 * Run: node scripts/test_privacy.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { languages, translator } from './localization.mjs';
import { runtimeSources, translateScript } from './localization-runtime.mjs';

const source = readFileSync(new URL('../assets/privacy-controls.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/privacy-controls.css', import.meta.url), 'utf8');
const KEY = 'vektorium.analytics-consent.v1';
const ID = 'G-KZL0QVQ6XC';
const DISABLE = 'ga-disable-' + ID;

function fixture(options = {}) {
  let document;
  let head;
  let reloads = 0;
  const scriptLoads = [];
  const cookieWrites = [];
  const storageWrites = [];
  const steps = [];
  const storage = options.storage || new Map();
  if (options.preference !== undefined) storage.set(KEY, options.preference);

  class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler, configuration = {}) {
      const list = this.listeners.get(type) || [];
      list.push({ handler, once: configuration.once === true });
      this.listeners.set(type, list);
    }
    fire(type, event = {}) {
      let prevented = false;
      const payload = { target: this, preventDefault: () => { prevented = true; }, ...event };
      for (const entry of [...(this.listeners.get(type) || [])]) {
        entry.handler(payload);
        if (entry.once) this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== entry));
      }
      return { prevented };
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
      if (tagName !== 'dialog' || options.dialogOpenProperty !== false) this.open = false;
      this.disabled = false;
      this.inert = false;
      this.removed = false;
      this.style = new Proxy({}, { set() { throw new Error('Inline style writes are forbidden'); } });
      if (tagName === 'dialog' && options.nativeDialog !== false) {
        this.showModal = () => { this.open = true; this.attributes.open = ''; };
        this.close = () => { this.open = false; delete this.attributes.open; this.fire('close'); };
      }
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parentElement = this;
        this.children.push(node);
        if (this === head && node.tagName === 'script') {
          assert.equal(window[DISABLE], false, 'tag insertion occurs only after the enabled decision');
          scriptLoads.push(node);
          steps.push('script');
        }
      }
    }
    setAttribute(name, value) {
      assert.notEqual(name.toLowerCase(), 'style');
      assert.equal(/^on/i.test(name), false);
      this.attributes[name] = String(value);
      if (name === 'open' && Object.hasOwn(this, 'open')) this.open = true;
    }
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === 'open' && Object.hasOwn(this, 'open')) this.open = false;
    }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    closest(selector) {
      let node = this;
      while (node) {
        if (matches(node, selector)) return node;
        node = node.parentElement;
      }
      return null;
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; }
    remove() {
      this.removed = true;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    }
    set innerHTML(_value) { throw new Error('innerHTML is forbidden'); }
    insertAdjacentHTML() { throw new Error('insertAdjacentHTML is forbidden'); }
  }

  function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }
  function matches(node, selector) {
    if (selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1));
    if (selector.startsWith('[')) return Object.hasOwn(node.attributes, selector.slice(1, -1));
    return node.tagName === selector;
  }
  head = new Element('head');
  const body = new Element('body');
  const originalMain = new Element('main');
  originalMain.className = 'original-content';
  const originalCursor = new Element('div');
  originalCursor.id = 'cursorDot';
  const originalCanvas = new Element('canvas');
  originalCanvas.id = 'fluidCanvas';
  body.append(originalMain, originalCursor, originalCanvas);
  const footer = new Element('footer');
  const footerBottom = new Element('div');
  footerBottom.className = 'footer-bottom';
  if (options.footerBottom !== false) footer.append(footerBottom);
  if (options.footer !== false) body.append(footer);
  const nodes = () => [head, body, ...descendants(head), ...descendants(body)];
  const select = (attribute, value = '') => nodes().find(node => node.attributes[attribute] === value);

  document = new Events();
  Object.assign(document, {
    head, body, readyState: options.readyState || 'complete',
    visibilityState: 'visible',
    referrer: options.referrer ?? 'https://referrer.example/private-path?private=1#secret',
    activeElement: body,
    createElement: tag => new Element(tag),
    querySelector: selector => nodes().find(node => matches(node, selector)) || null
  });
  Object.defineProperty(document, 'cookie', {
    get() {
      if (options.cookieReadBlocked) throw new Error('Cookies cannot be read');
      return options.cookies || '';
    },
    set(value) {
      assert.equal(window[DISABLE], true, 'GA is disabled before cookie cleanup');
      if (options.cookieWriteBlocked) throw new Error('Cookies cannot be written');
      cookieWrites.push(value);
    }
  });
  const localStorage = {
    getItem(key) {
      steps.push('read');
      if (options.storageReadBlocked) throw new Error('Storage read blocked');
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.storageWriteBlocked) throw new Error('Storage write blocked');
      storageWrites.push([key, value]);
      if (!options.storageWriteSilent) storage.set(key, value);
    }
  };
  const window = new Events();
  const hostname = options.hostname || 'vektorium.io';
  const protocol = options.protocol || 'https:';
  Object.assign(window, {
    localStorage,
    location: {
      hostname, protocol, origin: protocol + '//' + hostname,
      pathname: options.pathname || '/insights/article', search: '?secret=1', hash: '#private',
      reload() {
        assert.equal(window[DISABLE], true, 'disabled flag remains set through every clean reload');
        reloads += 1;
        if (options.reloadBlocked) throw new Error('Reload blocked');
      }
    },
    doNotTrack: options.windowDNT,
    fetch() { throw new Error('No network in tests'); }
  });
  const navigator = {
    globalPrivacyControl: options.gpc, doNotTrack: options.dnt, msDoNotTrack: options.msDNT,
    sendBeacon() { throw new Error('No network in tests'); }
  };
  const context = vm.createContext({ window, document, navigator, URL, Set, Date }, {
    codeGeneration: { strings: false, wasm: false }
  });
  const execute = () => vm.runInContext(options.scriptSource || source, context, { filename: 'assets/privacy-controls.js', timeout: 1000 });
  execute();
  return {
    window, document, navigator, options, storage, storageWrites, scriptLoads, cookieWrites, steps,
    nodes, footer, footerBottom, originalMain, originalCursor, originalCanvas, execute,
    reloads: () => reloads,
    settings: () => select('data-vx-privacy-settings'),
    dialog: () => select('data-vx-privacy-dialog'),
    close: () => select('data-vx-privacy-close'),
    button: value => select('data-vx-analytics-choice', value),
    state: () => nodes().find(node => node.className === 'vx-privacy-current'),
    status: () => nodes().find(node => node.className === 'vx-privacy-status'),
    title: () => nodes().find(node => node.id === 'vx-privacy-title'),
    show() { return select('data-vx-privacy-settings').fire('click'); },
    choose(choice) {
      const button = select('data-vx-analytics-choice', choice);
      assert(button, 'choice button exists');
      assert.equal(button.disabled, false, 'choice is available');
      button.fire('click');
    },
    otherTab(value, eventKey = KEY, extra = {}) {
      if (value === null) storage.delete(KEY);
      else storage.set(KEY, value);
      return window.fire('storage', { key: eventKey, newValue: value, storageArea: localStorage, ...extra });
    }
  };
}

test('readable absent preference uses owner default on, without recording consent or showing a banner', () => {
  const f = fixture();
  assert.equal(f.scriptLoads.length, 1);
  assert.equal(f.window[DISABLE], false);
  assert.equal(f.storage.size, 0);
  assert.equal(f.storageWrites.length, 0);
  assert.equal(f.dialog().open, false);
  assert.equal(f.document.activeElement, f.document.body);
  assert.equal(f.state().textContent, 'Analytics on');
  assert.equal(f.steps[0], 'read');
  assert(f.steps.indexOf('read') < f.steps.indexOf('script'));
});

test('only the existing measurement ID and exact tag endpoint are configured', () => {
  const f = fixture();
  assert.equal(f.scriptLoads[0].src, 'https://www.googletagmanager.com/gtag/js?id=' + ID);
  assert.equal(f.scriptLoads[0].attributes['data-vx-analytics'], 'enabled');
  assert.equal(f.scriptLoads[0].referrerPolicy, 'no-referrer');
  const commands = f.window.dataLayer;
  assert.equal(commands.filter(item => item[0] === 'config').length, 1);
  assert.equal(commands.filter(item => item[0] === 'consent').length, 0);
  const configuration = commands.find(item => item[0] === 'config');
  assert.equal(configuration[1], ID);
  assert.equal(configuration[2].page_location, 'https://vektorium.io/insights/article');
  assert.equal(configuration[2].page_referrer, 'https://referrer.example');
  assert.equal(configuration[2].allow_google_signals, false);
  assert.equal(configuration[2].allow_ad_personalization_signals, false);
  assert.equal(configuration[2].cookie_domain, 'vektorium.io');
  assert.equal(configuration[2].cookie_path, '/');
  assert.equal(configuration[2].cookie_flags, 'SameSite=Lax;Secure');
});

test('saved opt-out is enforced before any tag/config/dataLayer initialization', () => {
  const f = fixture({ preference: 'denied', cookies: '_ga=old; unrelated=keep' });
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.window.dataLayer, undefined);
  assert.equal(f.state().textContent, 'Analytics off');
  assert(f.cookieWrites.some(value => value.startsWith('_ga=')));
  assert(f.cookieWrites.every(value => !value.startsWith('unrelated=')));
});

test('saved on is honored only on the two exact HTTPS production hosts', () => {
  for (const hostname of ['vektorium.io', 'www.vektorium.io']) {
    assert.equal(fixture({ hostname, preference: 'granted' }).scriptLoads.length, 1, hostname);
  }
  for (const hostname of ['preview.vercel.app', 'localhost', '127.0.0.1', 'vektorium.io.evil.example', 'www.vektorium.io.evil.example', 'demo.vektorium.io']) {
    const f = fixture({ hostname, preference: 'granted' });
    assert.equal(f.scriptLoads.length, 0, hostname);
    assert.equal(f.window[DISABLE], true);
    assert.equal(f.button('on').disabled, true);
    f.button('on').fire('click');
    assert.equal(f.scriptLoads.length, 0, 'manual dispatch cannot bypass host gate');
  }
  assert.equal(fixture({ protocol: 'http:' }).scriptLoads.length, 0);
});

test('GPC and all supported DNT sources override default and saved on', () => {
  for (const signals of [{ gpc: true }, { dnt: '1' }, { msDNT: '1' }, { windowDNT: '1' }]) {
    for (const preference of [undefined, 'granted']) {
      const f = fixture({ ...signals, preference });
      assert.equal(f.scriptLoads.length, 0);
      assert.equal(f.window[DISABLE], true);
      assert.equal(f.button('on').disabled, true);
      assert.match(f.status().textContent, /privacy|Do Not Track/i);
      f.button('on').fire('click');
      assert.equal(f.scriptLoads.length, 0);
    }
  }
});

test('DNT 0 and false GPC do not become opt-outs', () => {
  assert.equal(fixture({ gpc: false, dnt: '0', windowDNT: '0' }).scriptLoads.length, 1);
});

test('unreadable preferences fail closed with a truthful explanation', () => {
  const f = fixture({ storageReadBlocked: true, preference: 'granted' });
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.window[DISABLE], true);
  assert.match(f.status().textContent, /did not allow saved preferences to be read/i);
});

test('invalid preference values fail closed', () => {
  for (const preference of ['', 'yes', 'on', 'false', '<script>']) {
    assert.equal(fixture({ preference }).scriptLoads.length, 0, preference);
  }
});

test('settings opens a labeled modal with focus and accurate on/off controls', () => {
  const f = fixture();
  assert.equal(f.settings().parentElement, f.footerBottom);
  assert.equal(f.settings().attributes['aria-haspopup'], 'dialog');
  f.show();
  assert.equal(f.dialog().open, true);
  assert.equal(f.dialog().attributes.role, 'dialog');
  assert.equal(f.dialog().attributes['aria-modal'], 'true');
  assert.equal(f.dialog().attributes['aria-labelledby'], f.title().id);
  assert.equal(f.settings().attributes['aria-expanded'], 'true');
  assert.equal(f.document.activeElement, f.title());
  assert.equal(f.button('off').textContent, 'Analytics off');
  assert.equal(f.button('on').textContent, 'Analytics on');
  assert.equal(f.button('on').attributes['aria-pressed'], 'true');
  assert(f.nodes().some(node => node.href === '/privacy-policy'));
});

test('close, Escape and cancel return focus without modifying the choice', () => {
  const f = fixture();
  for (const action of ['close', 'escape', 'cancel']) {
    f.show();
    if (action === 'close') f.close().fire('click');
    if (action === 'escape') assert.equal(f.dialog().fire('keydown', { key: 'Escape' }).prevented, true);
    if (action === 'cancel') assert.equal(f.dialog().fire('cancel').prevented, true);
    assert.equal(f.dialog().open, false);
    assert.equal(f.document.activeElement, f.settings());
    assert.equal(f.settings().attributes['aria-expanded'], 'false');
    assert.equal(f.storageWrites.length, 0);
  }
});

test('keyboard focus cycles within the modal, including privacy-signal disabled on button', () => {
  for (const gpc of [false, true]) {
    const f = fixture({ gpc });
    f.show();
    const last = gpc ? f.button('off') : f.button('on');
    assert.equal(f.dialog().fire('keydown', { key: 'Tab', shiftKey: true }).prevented, true);
    assert.equal(f.document.activeElement, last);
    assert.equal(f.dialog().fire('keydown', { key: 'Tab' }).prevented, true);
    assert.equal(f.document.activeElement, f.close());
  }
});

test('fallback modal preserves pre-existing inert state and contains focus', () => {
  const f = fixture({ nativeDialog: false });
  f.originalCanvas.inert = true;
  f.show();
  assert.equal(f.dialog().open, true);
  assert.equal(f.originalMain.inert, true);
  f.originalMain.focus();
  f.document.fire('focusin', { target: f.originalMain });
  assert.equal(f.document.activeElement, f.title());
  f.close().fire('click');
  assert.equal(f.originalMain.inert, false);
  assert.equal(f.originalCanvas.inert, true);
  assert.equal(f.dialog().open, false);
  assert.equal(f.document.activeElement, f.settings());
});

test('fallback modal without an open property can close and restore an interactive page', () => {
  const f = fixture({ nativeDialog: false, dialogOpenProperty: false });
  assert.equal(f.dialog().open, undefined);
  f.show();
  assert.equal(f.dialog().hasAttribute('open'), true);
  assert.equal(f.originalMain.inert, true);
  f.originalMain.focus();
  f.document.fire('focusin', { target: f.originalMain });
  assert.equal(f.document.activeElement, f.title());
  f.close().fire('click');
  assert.equal(f.dialog().hasAttribute('open'), false);
  assert.equal(f.originalMain.inert, false);
  assert.equal(f.document.activeElement, f.settings());
});

test('a durable opt-out disables the loaded tag, clears GA cookies and cleanly reloads once', () => {
  const f = fixture({ cookies: '_ga=old; _ga_OTHER=old; _gid=old; _gat_test=old; important_session=keep' });
  const script = f.scriptLoads[0];
  f.show();
  f.choose('off');
  assert.equal(f.storage.get(KEY), 'denied');
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.state().textContent, 'Analytics off');
  assert.equal(script.removed, true);
  assert.equal(f.reloads(), 1);
  assert(f.cookieWrites.some(value => value.startsWith('_ga_OTHER=')));
  assert(f.cookieWrites.every(value => !value.startsWith('important_session=')));
  f.choose('off');
  assert.equal(f.reloads(), 1);
  assert.equal(fixture({ storage: f.storage }).scriptLoads.length, 0, 'fresh page honors durable off');
});

test('late load/error callbacks and late gtag calls cannot undo an opt-out', () => {
  const f = fixture();
  const script = f.scriptLoads[0];
  const count = f.window.dataLayer.length;
  f.choose('off');
  script.fire('load');
  script.fire('error');
  f.window.gtag('event', 'late_callback');
  f.window.gtag('config', ID);
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.window.dataLayer.length, count);
  assert.equal(f.scriptLoads.length, 1);
  assert.equal(f.state().textContent, 'Analytics off');
  assert(!f.window.dataLayer.some(command => command[0] === 'consent'));
});

test('saved off can be enabled once, without duplicate tag/config/page views on repeated on', () => {
  const f = fixture({ preference: 'denied' });
  f.choose('on');
  f.choose('on');
  f.show();
  f.choose('on');
  assert.equal(f.storage.get(KEY), 'granted');
  assert.equal(f.scriptLoads.length, 1);
  assert.equal(f.window.dataLayer.filter(command => command[0] === 'config').length, 1);
  assert.equal(f.window.dataLayer.filter(command => command[0] === 'event').length, 0);
  assert.equal(f.reloads(), 0);
});

test('storage-blocked off stays disabled without reloading into a stale default/on preference', () => {
  const f = fixture({ storageWriteBlocked: true, preference: 'granted' });
  const script = f.scriptLoads[0];
  f.choose('off');
  assert.equal(f.storage.get(KEY), 'granted');
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.reloads(), 0);
  assert.equal(script.removed, true);
  assert.match(f.status().textContent, /did not allow the opt-out to be saved/i);
  assert.match(f.status().textContent, /may be on again after navigation or reload/i);
  script.fire('load');
  assert.equal(f.window[DISABLE], true);
});

test('silently failed storage writes are not reported as durable', () => {
  const f = fixture({ storageWriteSilent: true });
  f.choose('off');
  assert.equal(f.reloads(), 0);
  assert.equal(f.window[DISABLE], true);
  assert.match(f.status().textContent, /could not|did not allow/i);
});

test('explicit page-only on can proceed from unreadable storage with an honest limit', () => {
  const f = fixture({ storageReadBlocked: true, storageWriteBlocked: true });
  f.choose('on');
  assert.equal(f.scriptLoads.length, 1);
  assert.match(f.status().textContent, /on for this page only/i);
  f.choose('off');
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.reloads(), 0);
});

test('stopped analytics is never restarted in-place after a page-only opt-out', () => {
  const f = fixture({ storageWriteBlocked: true });
  f.choose('off');
  f.choose('on');
  assert.equal(f.scriptLoads.length, 1);
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.reloads(), 0);
  assert.match(f.status().textContent, /stays off on this page/i);
  f.options.storageWriteBlocked = false;
  f.choose('on');
  assert.equal(f.storage.get(KEY), 'granted');
  assert.equal(f.reloads(), 1);
  assert.equal(f.window[DISABLE], true, 'waits for clean reload, not a stale script');
});

test('same-origin cross-tab off disables an active tab and survives reload', () => {
  const f = fixture();
  const script = f.scriptLoads[0];
  f.otherTab('denied');
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.reloads(), 1);
  assert.equal(script.removed, true);
  script.fire('load');
  assert.equal(f.window[DISABLE], true);
  assert.equal(fixture({ storage: f.storage }).scriptLoads.length, 0);
});

test('removal, clear and invalid cross-tab values become durable off, not default-on reload loops', () => {
  for (const [value, key] of [[null, KEY], [null, null], ['garbage', KEY]]) {
    const f = fixture();
    f.otherTab(value, key);
    assert.equal(f.window[DISABLE], true);
    assert.equal(f.storage.get(KEY), 'denied');
    assert.equal(f.reloads(), 1);
    const next = fixture({ storage: f.storage });
    assert.equal(next.scriptLoads.length, 0);
    assert.equal(next.reloads(), 0);
  }
});

test('cross-tab removal with blocked persistence is page-only off and never reloads', () => {
  const f = fixture({ storageWriteBlocked: true });
  f.otherTab(null);
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.reloads(), 0);
  assert.match(f.status().textContent, /could not be saved/i);
});

test('cross-tab on requires matching stored preference and cannot duplicate initialization', () => {
  const f = fixture({ preference: 'denied' });
  f.otherTab('granted');
  f.otherTab('granted');
  assert.equal(f.scriptLoads.length, 1);
  assert.equal(f.window.dataLayer.filter(command => command[0] === 'config').length, 1);
  const stale = fixture({ preference: 'denied' });
  stale.window.fire('storage', { key: KEY, newValue: 'granted' });
  assert.equal(stale.scriptLoads.length, 0);
  assert.equal(stale.storage.get(KEY), 'denied');
});

test('cross-tab on still respects GPC, DNT and preview host gates', () => {
  for (const options of [{ gpc: true }, { dnt: '1' }, { hostname: 'preview.vercel.app' }]) {
    const f = fixture({ ...options, preference: 'denied' });
    f.otherTab('granted');
    assert.equal(f.scriptLoads.length, 0);
    assert.equal(f.window[DISABLE], true);
  }
});

test('unrelated storage keys and other storage areas do not change measurement', () => {
  const f = fixture();
  f.window.fire('storage', { key: 'unrelated', newValue: 'denied' });
  f.window.fire('storage', { key: KEY, newValue: 'denied', storageArea: {} });
  assert.equal(f.window[DISABLE], false);
  assert.equal(f.reloads(), 0);
});

test('focus, visibility and pageshow recheck missed revocations without duplicate reloads', () => {
  for (const event of ['focus', 'pageshow', 'visibilitychange']) {
    const f = fixture();
    f.storage.set(KEY, 'denied');
    (event === 'visibilitychange' ? f.document : f.window).fire(event);
    assert.equal(f.window[DISABLE], true);
    assert.equal(f.reloads(), 1);
    f.window.fire('focus');
    assert.equal(f.reloads(), 1);
  }
});

test('a newly enabled browser privacy signal disables an existing tag', () => {
  const f = fixture();
  f.navigator.globalPrivacyControl = true;
  f.window.fire('focus');
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.reloads(), 1);
  assert.equal(f.button('on').disabled, true);
});

test('blocked storage reads on returning focus disable without unsafe reload', () => {
  const f = fixture();
  f.options.storageReadBlocked = true;
  f.window.fire('focus');
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.reloads(), 0);
});

test('cookie cleanup covers root/www/current path scopes, not unrelated cookies/storage', () => {
  const f = fixture({ hostname: 'www.vektorium.io', preference: 'denied', cookies: '_ga_A=1; _gid=2; account=keep' });
  for (const domain of ['Domain=www.vektorium.io', 'Domain=.www.vektorium.io', 'Domain=vektorium.io', 'Domain=.vektorium.io']) {
    assert(f.cookieWrites.some(value => value.includes(domain)), domain);
  }
  for (const path of ['Path=/;', 'Path=/insights;', 'Path=/insights/;', 'Path=/insights/article;', 'Path=/insights/article/;']) {
    assert(f.cookieWrites.some(value => value.includes(path)), path);
  }
  assert(f.cookieWrites.every(value => !value.startsWith('account=')));
  assert(f.storageWrites.every(([key]) => key === KEY));
});

test('blocked cookie reads/writes cannot break off controls or cause analytics to resume', () => {
  for (const options of [{ cookieReadBlocked: true }, { cookieWriteBlocked: true }, { cookieReadBlocked: true, cookieWriteBlocked: true }]) {
    const f = fixture(options);
    f.choose('off');
    assert.equal(f.window[DISABLE], true);
    assert.equal(f.storage.get(KEY), 'denied');
    assert.equal(f.reloads(), 1);
  }
});

test('untrusted cookie path characters are not copied into cookie attributes', () => {
  const f = fixture({ preference: 'denied', pathname: '/safe/;Domain=other.example' });
  assert(f.cookieWrites.every(value => !value.includes('Domain=other.example')));
});

test('failed analytics load stays non-fatal and does not automatically retry or reenable', () => {
  const f = fixture();
  const script = f.scriptLoads[0];
  script.fire('error');
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.state().textContent, 'Analytics off');
  assert.match(f.status().textContent, /could not load/i);
  script.fire('load');
  assert.equal(f.window[DISABLE], true);
  f.show();
  assert.equal(f.dialog().open, true);
  assert.equal(f.scriptLoads.length, 1);
});

test('blocked reload leaves collection disabled and explains manual reload', () => {
  const f = fixture({ reloadBlocked: true });
  f.choose('off');
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.storage.get(KEY), 'denied');
  assert.match(f.status().textContent, /blocked reloading/i);
});

test('malformed, empty and non-HTTP referrers are not sent', () => {
  for (const referrer of ['not a URL', '', 'file:///private/file', 'data:text/plain,private']) {
    const f = fixture({ referrer });
    const config = f.window.dataLayer.find(item => item[0] === 'config')[2];
    assert.equal(config.page_referrer, '');
  }
});

test('deferred initialization is once-only and duplicate script inclusion changes nothing', () => {
  const f = fixture({ readyState: 'loading' });
  assert.equal(f.window[DISABLE], true);
  assert.equal(f.scriptLoads.length, 0);
  assert.equal(f.settings(), undefined);
  f.document.fire('DOMContentLoaded');
  f.document.fire('DOMContentLoaded');
  f.execute();
  assert.equal(f.scriptLoads.length, 1);
  assert.equal(f.window[DISABLE], false);
  assert.equal(f.nodes().filter(node => node.attributes['data-vx-privacy-settings'] === '').length, 1);
});

test('footer fallback supports legacy footer and footer-free pages without original DOM edits', () => {
  for (const options of [{ footerBottom: false }, { footer: false }]) {
    const f = fixture(options);
    assert.equal(f.settings().parentElement, options.footer === false ? f.document.body : f.footer);
    assert.equal(f.originalMain.className, 'original-content');
    assert.equal(f.originalCursor.id, 'cursorDot');
    assert.equal(f.originalCanvas.id, 'fluidCanvas');
    assert.equal(f.originalCursor.removed, false);
    assert.equal(f.originalCanvas.removed, false);
  }
});

test('new CSS is privacy-only, closes by default, and supplies its own usable native cursor', () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
    const selectors = match[1].trim();
    if (selectors.startsWith('@')) continue;
    for (const selector of selectors.split(',')) assert.match(selector.trim(), /^\.vx-privacy-/, selector);
  }
  assert.match(css, /\.vx-privacy-dialog\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.vx-privacy-dialog\[open\]\s*\{\s*display:\s*block/);
  assert.match(css, /cursor:\s*auto/);
  assert.match(css, /cursor:\s*pointer/);
  assert(!css.includes('url('));
  assert(!source.includes('innerHTML'));
  assert(!source.includes('eval('));
});

function clickLink(f, href, extra = {}) {
  const link = f.document.createElement('a');
  link.setAttribute('href', href);
  const nested = f.document.createElement('span');
  link.append(nested);
  f.originalMain.append(link);
  f.document.fire('click', { target: nested, button: 0, ...extra });
}

function measuredEvents(f) {
  return JSON.parse(JSON.stringify((f.window.dataLayer || []).filter(entry => entry[0] === 'event')
    .map(entry => [entry[1], entry[2]])));
}

test('demo and contact interactions send only fixed intent categories', () => {
  const f = fixture({ pathname: '/architecture' });
  clickLink(f, 'https://demo.vektorium.io/?private=secret#private');
  clickLink(f, 'https://mobile-demo.vektorium.io/demo?private=secret');
  clickLink(f, '/contact?private=secret');
  const addresses = ['massimo.prando@vektorium.io', 'info@vektorium.io',
    'sales@vektorium.io', 'tech@vektorium.io', 'marketing@vektorium.io',
    'security@vektorium.io', 'privacy@vektorium.io'];
  for (const address of addresses) clickLink(f, `mailto:${address}?subject=private&body=secret`);
  assert.deepEqual(measuredEvents(f), [
    ['demo_open', { demo_variant: 'desktop' }],
    ['demo_open', { demo_variant: 'mobile' }],
    ['contact_intent', { contact_method: 'contact_page' }],
    ...addresses.map(() => ['contact_intent', { contact_method: 'email' }])
  ]);
  assert(!JSON.stringify(measuredEvents(f)).match(/private|secret|mailto|@|generate_lead/));
});

test('interaction measurement honors opt-outs, privacy signals and nonproduction hosts', () => {
  for (const options of [{ preference: 'denied' }, { gpc: true }, { dnt: '1' },
    { msDNT: '1' }, { windowDNT: '1' }, { hostname: 'localhost' },
    { hostname: 'preview.vercel.app' }, { protocol: 'http:' }, { storageReadBlocked: true }]) {
    const f = fixture(options);
    clickLink(f, 'https://demo.vektorium.io/');
    clickLink(f, '/contact');
    clickLink(f, 'mailto:info@vektorium.io');
    assert.deepEqual(measuredEvents(f), []);
  }
});

test('opt-out immediately stops interaction events including after a tag load error', () => {
  const f = fixture();
  clickLink(f, '/contact');
  f.choose('off');
  clickLink(f, 'https://demo.vektorium.io/');
  assert.equal(measuredEvents(f).length, 1);
  const failed = fixture();
  failed.scriptLoads[0].fire('error');
  clickLink(failed, '/contact');
  assert.deepEqual(measuredEvents(failed), []);
});

test('unrelated, lookalike and prevented link actions do not create intent events', () => {
  const f = fixture();
  for (const href of ['/cypher-sentinel', 'https://example.com/contact',
    'https://demo.vektorium.io.example.com/', 'https://user@demo.vektorium.io/',
    'https://demo.vektorium.io/unknown', 'mailto:another@example.com',
    'mailto:other@vektorium.io', 'mailto:info@vektorium.io.example.com',
    'mailto:info@vektorium.io,another@example.com', 'javascript:void(0)']) clickLink(f, href);
  clickLink(f, '/contact', { defaultPrevented: true });
  clickLink(f, '/contact', { button: 2 });
  assert.deepEqual(measuredEvents(f), []);
});

test('copy button records intent only on the contact page without accessing the clipboard', () => {
  for (const pathname of ['/contact', '/contact/', '/another-page']) {
    const f = fixture({ pathname });
    const button = f.document.createElement('button');
    button.id = 'copyBtn';
    f.originalMain.append(button);
    f.document.fire('click', { target: button, button: 0 });
    assert.deepEqual(measuredEvents(f), pathname.startsWith('/contact')
      ? [['contact_intent', { contact_method: 'copy_button' }]] : []);
  }
});

test('translated privacy controls retain opt-outs, host and signal gates, and localized links', () => {
  const runtime = runtimeSources([source], readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  for (const { code } of languages.slice(1)) {
    const translate = translator(JSON.parse(readFileSync(new URL(`../locales/${code}.json`, import.meta.url), 'utf8')));
    const scriptSource = translateScript(source, translate, runtime, code);
    const f = fixture({ scriptSource, preference: 'denied', pathname: `/${code}/contact` });
    assert.equal(f.scriptLoads.length, 0, code);
    assert.equal(f.settings().textContent, translate('Privacy settings'), code);
    f.show();
    assert.equal(f.title().textContent, translate('Privacy settings'), code);
    assert.equal(f.state().textContent, translate('Analytics off'), code);
    assert.equal(f.nodes().find(node => node.className === 'vx-privacy-link').href, `/${code}/privacy-policy`, code);
    f.choose('on');
    assert.equal(f.scriptLoads.length, 1, code);
    assert.equal(f.storage.get(KEY), 'granted', code);
    assert.equal(f.state().textContent, translate('Analytics on'), code);
    clickLink(f, `/${code}/contact`);
    assert.deepEqual(measuredEvents(f), [['contact_intent', { contact_method: 'contact_page' }]], code);
    f.choose('off');
    assert.equal(f.window[DISABLE], true, code);
    assert.equal(f.storage.get(KEY), 'denied', code);
    assert.equal(f.reloads(), 1, code);
    for (const options of [{ hostname: 'preview.vercel.app' }, { gpc: true }, { dnt: '1' }]) {
      const blocked = fixture({ ...options, scriptSource, preference: 'granted' });
      assert.equal(blocked.scriptLoads.length, 0, code);
      assert.equal(blocked.button('on').disabled, true, code);
      blocked.button('on').fire('click');
      assert.equal(blocked.scriptLoads.length, 0, code);
    }
  }
});
