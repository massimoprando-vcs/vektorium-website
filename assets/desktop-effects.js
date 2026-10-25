/* Vektorium's original desktop effects, isolated from essential functionality.
   No inline styles, HTML injection, external dependencies or network requests.
   Dynamic presentation uses the Web Animations API, not style attributes. */
(() => {
  'use strict';

  if (!window.matchMedia || !window.requestAnimationFrame || !window.cancelAnimationFrame) return;
  const root = document.documentElement;
  if (!root) return;
  const desktop = window.matchMedia('(min-width: 1025px) and (hover: hover) and (pointer: fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = window.matchMedia('(forced-colors: active)');
  const seenReveals = new WeakSet();
  const seenCounters = new WeakSet();
  const seenVisions = new WeakSet();
  let heroPlayed = false;
  let session = null;
  let ready = false;
  let pageAway = false;

  // The same three-octave fluid/noise shader and pointer-light equations used
  // by the original website (cef245c), now with lifecycle/resource cleanup.
  const VERTEX_SHADER = 'attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0,1);}';
  const FRAGMENT_SHADER = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_mouseActive;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<3;i++){v+=a*noise(p);p*=2.0;a*=0.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;float t=u_time*0.15;
  vec2 q=vec2(fbm(uv*3.0+t*0.3),fbm(uv*3.0+vec2(1.7,9.2)+t*0.2));
  float f=fbm(uv*3.0+q);
  vec3 col=mix(vec3(0.039,0.055,0.102),vec3(0.06,0.08,0.16),f);
  col=mix(col,vec3(0.0,0.15,0.3),pow(f,2.0)*0.5);
  col=mix(col,vec3(0.0,0.5,0.8),pow(f,4.0)*0.15);
  if(u_mouseActive>0.5){
    vec2 mouse=u_mouse/u_resolution;float d=length(uv-mouse);
    col+=mix(vec3(0.0,0.5,1.0),vec3(0.0,0.8,0.6),f)*exp(-d*d*12.0)*0.4;
  }
  col+=vec3(0.05,0.08,0.15)*smoothstep(0.7,0.0,uv.y)*0.5;
  col*=1.0-dot(uv-0.5,uv-0.5)*1.2;
  gl_FragColor=vec4(col,1.0);
}`;

  function createSession() {
    const dot = document.getElementById('cursorDot');
    const ring = document.getElementById('cursorRing');
    const canvas = document.getElementById('fluidCanvas');
    const indicator = document.getElementById('scrollIndicator');
    const header = document.querySelector('.header');
    const headerParts = [...document.querySelectorAll('.header-left,.header-center,.header-right')];
    const track = document.getElementById('tickerTrack');
    const indicatorOriginal = indicator?.textContent;
    const listeners = [];
    const observers = [];
    const animations = new Set();
    const pausedAnimations = new Set();
    const poses = new Map();
    const counters = new Map();
    const pendingEntries = [];
    const tickerCopies = [];
    let tickerButton = null;
    let alive = true;
    let paused = false;
    let frameId = null;
    let fallbackTimer = null;
    let previousTime = null;
    let elapsed = 0;
    let glState = null;
    let glFailed = false;
    let gpuRequested = false;
    let lastDraw = -Infinity;
    let resized = true;
    let scrollDirty = true;
    let glowDirty = false;
    let activeCard = null;
    let pointerActive = false;
    let pointerSeen = false;
    let mouseX = 0;
    let mouseY = 0;
    let dotX = 0;
    let dotY = 0;
    let ringX = 0;
    let ringY = 0;

    function on(target, type, handler, options) {
      if (!target) return;
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    }

    function animate(element, keyframes, options) {
      if (!element || typeof element.animate !== 'function') return null;
      try {
        const animation = element.animate(keyframes, { fill: 'backwards', ...options });
        animations.add(animation);
        animation.addEventListener('finish', () => {
          animations.delete(animation);
          pausedAnimations.delete(animation);
          animation.cancel();
        }, { once: true });
        if (paused) { animation.pause(); pausedAnimations.add(animation); }
        return animation;
      } catch {
        // Static styles already expose the full content if animation fails.
        return null;
      }
    }

    function pose(element, properties) {
      if (!element || typeof element.animate !== 'function') return false;
      try {
        let animation = poses.get(element);
        if (!animation) {
          animation = element.animate([properties], { duration: 1, fill: 'both' });
          animation.pause();
          poses.set(element, animation);
        } else animation.effect.setKeyframes([properties]);
        animation.currentTime = 1;
        return true;
      } catch {
        return false;
      }
    }

    function schedule() {
      if (alive && !paused && frameId === null) frameId = window.requestAnimationFrame(frame);
    }

    function clearFallback() {
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

    function requestGPU() {
      if (!canvas || glState || glFailed) return;
      clearFallback();
      gpuRequested = true;
      schedule();
    }

    function scheduleFallback() {
      if (!canvas || glState || glFailed || fallbackTimer !== null) return;
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        requestGPU();
      }, 15000);
    }

    function releaseGL() {
      if (glState) {
        const { gl, buffer, program, shaders } = glState;
        try {
          if (buffer) gl.deleteBuffer(buffer);
          if (program) gl.deleteProgram(program);
          for (const shader of shaders) gl.deleteShader(shader);
        } catch { /* A lost context already releases its resources. */ }
      }
      glState = null;
      root.classList.remove('vx-webgl-ready');
    }

    function startGL() {
      gpuRequested = false;
      if (!canvas || glState || glFailed) return;
      let gl;
      try {
        const attributes = { antialias: false, alpha: false, powerPreference: 'low-power' };
        gl = canvas.getContext('webgl', attributes) || canvas.getContext('experimental-webgl', attributes);
        if (!gl) { glFailed = true; return; }
        glState = { gl, shaders: [], program: null, buffer: null, ratio: 1 };
        for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]]) {
          const shader = gl.createShader(type);
          if (!shader) throw new Error('Shader unavailable');
          glState.shaders.push(shader);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation unavailable');
        }
        const program = gl.createProgram();
        if (!program) throw new Error('Program unavailable');
        glState.program = program;
        for (const shader of glState.shaders) gl.attachShader(program, shader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program linking unavailable');
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error('Buffer unavailable');
        glState.buffer = buffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'a_position');
        if (position < 0) throw new Error('Position attribute unavailable');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        glState.resolution = gl.getUniformLocation(program, 'u_resolution');
        glState.time = gl.getUniformLocation(program, 'u_time');
        glState.mouse = gl.getUniformLocation(program, 'u_mouse');
        glState.mouseActive = gl.getUniformLocation(program, 'u_mouseActive');
        resized = true;
        root.classList.add('vx-webgl-ready');
      } catch {
        glFailed = true;
        releaseGL();
      }
    }

    function drawGL() {
      if (!glState || elapsed - lastDraw < 33) return;
      const { gl } = glState;
      if (resized) {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        // Keep the original 1.5 DPR ceiling and bound ultra-wide/HiDPI cost.
        glState.ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(4000000 / (width * height)));
        canvas.width = Math.max(1, Math.floor(width * glState.ratio));
        canvas.height = Math.max(1, Math.floor(height * glState.ratio));
        resized = false;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(glState.resolution, canvas.width, canvas.height);
      gl.uniform1f(glState.time, elapsed * 0.001);
      gl.uniform2f(glState.mouse, mouseX * glState.ratio, (window.innerHeight - mouseY) * glState.ratio);
      gl.uniform1f(glState.mouseActive, pointerActive ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lastDraw = elapsed;
    }

    function updateScroll() {
      scrollDirty = false;
      const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const range = Math.max(0, height - window.innerHeight);
      const progress = range ? Math.min(100, Math.max(0, window.scrollY / range * 100)) : 0;
      if (indicator) indicator.textContent = 'SCROLL ' + String(Math.round(progress)).padStart(3, '0') + '%';
      const opacity = header?.contains(document.activeElement) ? 1 : Math.max(0, 1 - progress / 4);
      for (const part of headerParts) pose(part, { opacity });
      if (header) header.classList.toggle('vx-header-faded', opacity === 0);
    }

    function updateGlow() {
      glowDirty = false;
      if (!activeCard) return;
      const bounds = activeCard.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = Math.min(100, Math.max(0, (mouseX - bounds.left) / bounds.width * 100));
      const y = Math.min(100, Math.max(0, (mouseY - bounds.top) / bounds.height * 100));
      pose(activeCard.querySelector('.product-card-glow'), {
        background: `radial-gradient(circle at ${x}% ${y}%, rgba(0,212,255,0.08), transparent 60%)`
      });
    }

    function frame(time) {
      frameId = null;
      if (!alive || paused) return;
      try {
        const delta = previousTime === null ? 1000 / 60 : Math.max(0, time - previousTime);
        previousTime = time;
        elapsed += delta;
        if (gpuRequested) startGL();
        if (scrollDirty) updateScroll();
        if (glowDirty) updateGlow();
        let cursorMoving = false;
        if (pointerActive && dot && ring) {
          // Original 0.2 / 0.08 smoothing, normalized for high-refresh displays.
          const dotEase = 1 - Math.pow(0.8, delta / (1000 / 60));
          const ringEase = 1 - Math.pow(0.92, delta / (1000 / 60));
          dotX += (mouseX - dotX) * dotEase;
          dotY += (mouseY - dotY) * dotEase;
          ringX += (mouseX - ringX) * ringEase;
          ringY += (mouseY - ringY) * ringEase;
          const dotReady = pose(dot, { transform: `translate3d(${dotX}px,${dotY}px,0) translate(-50%,-50%)` });
          const ringReady = pose(ring, { transform: `translate3d(${ringX}px,${ringY}px,0) translate(-50%,-50%)` });
          root.classList.toggle('vx-pointer-ready', dotReady && ringReady);
          cursorMoving = Math.abs(mouseX - ringX) + Math.abs(mouseY - ringY) > 0.1;
        }
        for (const [element, counter] of counters) {
          const progress = Math.min(1, (elapsed - counter.started) / 960);
          element.textContent = progress === 1 ? counter.original : Math.round(counter.target * progress).toLocaleString();
          if (progress === 1) counters.delete(element);
        }
        drawGL();
        if (glState || cursorMoving || counters.size) schedule();
      } catch {
        // Never leave hidden content, a missing pointer or partial counters.
        stop();
      }
    }

    function reveal(element) {
      if (seenReveals.has(element)) return;
      seenReveals.add(element);
      animate(element, [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 800, easing: 'ease' });
    }

    function count(element) {
      if (seenCounters.has(element)) return;
      seenCounters.add(element);
      const original = element.textContent;
      const target = Number(element.dataset.target ?? element.dataset.count);
      // Only animate the numeric value already displayed; never add a claim.
      if (!Number.isFinite(target) || target < 0 || Number(original.replace(/,/g, '').trim()) !== target) return;
      counters.set(element, { original, target, started: elapsed });
      element.textContent = '0';
      schedule();
    }

    function vision(element) {
      if (seenVisions.has(element)) return;
      seenVisions.add(element);
      element.querySelectorAll('.dim').forEach((word, index) => {
        word.classList.add('revealed');
        animate(word, [{ color: '#8090a5' }, { color: '#e8eaf0' }], { duration: 600, delay: index * 200, easing: 'ease' });
      });
    }

    function observe(selector, threshold, callback) {
      if (typeof window.IntersectionObserver !== 'function') return;
      const observer = new window.IntersectionObserver(entries => {
        if (!alive) return;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          if (paused) pendingEntries.push(() => callback(entry.target));
          else callback(entry.target);
        }
      }, { threshold });
      observers.push(observer);
      document.querySelectorAll(selector).forEach(element => observer.observe(element));
    }

    function setupTicker() {
      if (!track || !track.children.length) return;
      for (const item of [...track.children]) {
        const copy = item.cloneNode(true);
        copy.removeAttribute('id');
        copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        copy.setAttribute('data-vx-ticker-copy', '');
        copy.setAttribute('aria-hidden', 'true');
        copy.inert = true;
        tickerCopies.push(copy);
        track.append(copy);
      }
      tickerButton = document.createElement('button');
      tickerButton.className = 'vx-ticker-toggle';
      tickerButton.type = 'button';
      tickerButton.textContent = 'Pause highlights';
      tickerButton.setAttribute('aria-pressed', 'false');
      on(tickerButton, 'click', () => {
        const stopped = track.classList.toggle('vx-ticker-paused');
        tickerButton.textContent = stopped ? 'Resume highlights' : 'Pause highlights';
        tickerButton.setAttribute('aria-pressed', String(stopped));
      });
      track.parentElement.append(tickerButton);
    }

    function pointer(event) {
      if (event.pointerType === 'touch') {
        pointerActive = false;
        root.classList.remove('vx-pointer-ready');
        return;
      }
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (!pointerSeen) { dotX = ringX = mouseX; dotY = ringY = mouseY; pointerSeen = true; }
      pointerActive = true;
      const hovering = Boolean(event.target.closest?.('a,button,summary,.product-card,.diff-item,.faq-item,.highlight-box'));
      dot?.classList.toggle('hovering', hovering);
      ring?.classList.toggle('hovering', hovering);
      activeCard = event.target.closest?.('.product-card') || null;
      glowDirty = Boolean(activeCard);
      requestGPU();
      schedule();
    }

    function start() {
      root.classList.add('vx-desktop-effects');
      setupTicker();
      if (!heroPlayed) {
        heroPlayed = true;
        for (const [selector, duration, delay, distance] of [
          ['.hero-shield', 1000, 200, 0], ['.hero-title', 1200, 500, 30],
          ['.hero-tagline', 1200, 1200, 0], ['.hero-badge', 1000, 1800, 0]
        ]) {
          const element = document.querySelector(selector);
          if (element) animate(element,
            [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'translateY(0)' }],
            { duration, delay, easing: 'ease' });
        }
      }
      observe('.reveal', 0.15, reveal);
      observe('.counter,[data-count]', 0.5, count);
      observe('.vision-text', 0.3, vision);
      on(document, 'pointermove', pointer, { passive: true });
      on(document, 'pointerdown', pointer, { passive: true });
      on(document, 'pointerout', event => {
        if (!event.relatedTarget) {
          pointerActive = false;
          root.classList.remove('vx-pointer-ready');
          schedule();
        }
      }, { passive: true });
      on(document, 'keydown', event => {
        if (event.key === 'Tab') { pointerActive = false; root.classList.remove('vx-pointer-ready'); }
        requestGPU();
      });
      on(window, 'scroll', () => { scrollDirty = true; requestGPU(); schedule(); }, { passive: true });
      on(window, 'resize', () => { resized = true; scrollDirty = true; schedule(); }, { passive: true });
      on(header, 'focusin', () => { scrollDirty = true; schedule(); });
      on(header, 'focusout', () => { scrollDirty = true; schedule(); });
      on(canvas, 'webglcontextlost', event => {
        event.preventDefault();
        releaseGL();
        glFailed = true;
      });
      on(canvas, 'webglcontextrestored', () => { glFailed = false; requestGPU(); });
      scheduleFallback();
      schedule();
    }

    function pause() {
      if (!alive || paused) return;
      paused = true;
      pointerActive = false;
      root.classList.add('vx-effects-paused');
      root.classList.remove('vx-pointer-ready');
      clearFallback();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      previousTime = null;
      for (const animation of animations) {
        if (animation.playState === 'running') { animation.pause(); pausedAnimations.add(animation); }
      }
    }

    function resume() {
      if (!alive || !paused) return;
      paused = false;
      root.classList.remove('vx-effects-paused');
      for (const animation of pausedAnimations) animation.play();
      pausedAnimations.clear();
      for (const pending of pendingEntries.splice(0)) pending();
      scheduleFallback();
      schedule();
    }

    function stop() {
      if (!alive) return;
      alive = false;
      clearFallback();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      for (const remove of listeners) remove();
      for (const observer of observers) observer.disconnect();
      for (const animation of animations) animation.cancel();
      for (const animation of poses.values()) animation.cancel();
      animations.clear();
      poses.clear();
      pausedAnimations.clear();
      pendingEntries.length = 0;
      for (const [element, counter] of counters) element.textContent = counter.original;
      counters.clear();
      for (const copy of tickerCopies) copy.remove();
      tickerButton?.remove();
      track?.classList.remove('vx-ticker-paused');
      dot?.classList.remove('hovering');
      ring?.classList.remove('hovering');
      header?.classList.remove('vx-header-faded');
      if (indicator) indicator.textContent = indicatorOriginal;
      releaseGL();
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      root.classList.remove('vx-desktop-effects', 'vx-pointer-ready', 'vx-effects-paused');
    }

    return { start, pause, resume, stop };
  }

  function reconcile() {
    if (!ready) return;
    const eligible = desktop.matches && !reducedMotion.matches && !forcedColors.matches && !pageAway;
    if (!eligible) {
      session?.stop();
      session = null;
      return;
    }
    if (document.hidden) { session?.pause(); return; }
    if (!session) {
      session = createSession();
      try { session.start(); } catch { session.stop(); session = null; }
    } else session.resume();
  }

  function initialize() {
    ready = true;
    for (const query of [desktop, reducedMotion, forcedColors]) {
      if (query.addEventListener) query.addEventListener('change', reconcile);
      else if (query.addListener) query.addListener(reconcile);
    }
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('pagehide', () => { pageAway = true; reconcile(); });
    window.addEventListener('pageshow', () => { pageAway = false; reconcile(); });
    reconcile();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
