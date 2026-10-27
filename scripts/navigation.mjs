/** Shared, output-only navigation. Existing page markup is never reserialized. */
export const menuIcon = '<span class="vx-menu-icon" aria-hidden="true"><span></span><span></span><span></span></span>';

export const desktopMenu = `
<details class="vx-desktop-menu" data-search-ignore>
  <summary class="vx-menu-toggle" aria-label="Navigation menu" aria-controls="vx-desktop-panel">${menuIcon}</summary>
  <div class="vx-desktop-panel" id="vx-desktop-panel">
    <p class="vx-menu-title">Explore Vektorium</p>
    <div class="vx-menu-grid">
      <section class="vx-menu-group">
        <h2>Platform</h2>
        <a href="/cypher-sentinel">Cypher Sentinel</a>
        <a href="/architecture">Architecture</a>
        <a href="/integrations">Integrations</a>
        <a href="/sovereign-cybersecurity-platform">Sovereign platform</a>
        <a href="/cybersecurity-convergence-platform">Convergence</a>
        <a href="/#product">Security capabilities</a>
      </section>
      <section class="vx-menu-group">
        <h2>Solutions</h2>
        <a href="/critical-infrastructure-cybersecurity">Infrastructure</a>
        <a href="/post-quantum-cybersecurity">Post-quantum security</a>
        <a href="/ai-powered-siem-platform">AI-powered SIEM</a>
        <a href="/zero-trust-cybersecurity-platform">Zero trust</a>
      </section>
      <section class="vx-menu-group">
        <h2>Company &amp; resources</h2>
        <a href="/">Home</a>
        <a href="/#vision">Vision</a>
        <a href="/#about">About Vektorium</a>
        <a href="/#technology">Technology</a>
        <a href="/blog">Blog &amp; insights</a>
      </section>
    </div>
    <div class="vx-menu-actions">
      <a href="https://demo.vektorium.io/">View demo</a>
      <a href="/contact">Contact us</a>
    </div>
  </div>
</details>`;

const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const generatedClasses = new Set(['vx-mobile-header', 'vx-mobile-menu', 'vx-desktop-menu']);
const generatedIds = new Set(['vx-mobile-panel', 'vx-desktop-panel']);

/** Locate one reviewed primary-nav Contact anchor using real tokens only.
 * Markup-looking text in comments or raw script/style blocks is not a target. */
export function desktopNavigationEdit(page, tokens, readAttribute) {
  const classes = token => (readAttribute(token, 'class') || '').split(/\s+/);
  const hasClass = (token, name) => classes(token).includes(name);
  for (const token of tokens) {
    if (token.closing) continue;
    if (classes(token).some(name => generatedClasses.has(name)) || generatedIds.has(readAttribute(token, 'id'))) {
      throw new Error(`${page}: shared navigation must be inserted only by the build`);
    }
  }
  const expectedClass = page === 'index.html' ? 'floating-nav' : 'site-nav';
  const primary = tokens.filter(token => !token.closing && token.name === 'nav' &&
    (hasClass(token, expectedClass) || readAttribute(token, 'aria-label') === 'Primary navigation'));
  if (primary.length !== 1 || !hasClass(primary[0], expectedClass) ||
    ![undefined, 'Primary navigation'].includes(readAttribute(primary[0], 'aria-label'))) {
    throw new Error(`${page}: expected exactly one ${expectedClass} primary navigation`);
  }

  const nodes = [];
  const stack = [];
  let root;
  for (let index = tokens.indexOf(primary[0]); index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.closing) {
      const node = stack.pop();
      if (!node || node.token.name !== token.name) throw new Error(`${page}: malformed primary navigation nesting`);
      node.close = token;
      if (!stack.length) break;
    } else {
      const node = { token, parent: stack.at(-1) };
      if (!root) root = node;
      else if (token.name === 'nav') throw new Error(`${page}: nested primary navigation is not supported`);
      nodes.push(node);
      if (token.body === undefined && !voidElements.has(token.name) && !/\/\s*>$/.test(token.raw)) stack.push(node);
    }
  }
  if (!root.close) throw new Error(`${page}: unclosed primary navigation`);
  let container = root;
  if (page !== 'index.html') {
    const containers = nodes.filter(node => hasClass(node.token, 'nav-links'));
    if (containers.length !== 1 || containers[0].token.name !== 'div' || containers[0].parent !== root) {
      throw new Error(`${page}: expected exactly one direct nav-links container`);
    }
    container = containers[0];
  }
  const contacts = nodes.filter(node => node.token.name === 'a' && readAttribute(node.token, 'href') === '/contact');
  if (contacts.length !== 1 || contacts[0].parent !== container || !contacts[0].close) {
    throw new Error(`${page}: expected exactly one direct Contact anchor in primary navigation`);
  }
  const offset = contacts[0].close.end;
  return { start: offset, end: offset, text: desktopMenu };
}
