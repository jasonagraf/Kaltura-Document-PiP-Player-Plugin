// playkit-js-document-pip (v1.4.0)
// Routes the Kaltura Player V7 (Playkit) Picture-in-Picture action to Document PiP so overlay
// plugins (e.g. the dynamic watermark) are preserved in the floating window.
//
// v1.4.0: works from a SCRIPT TAG ALONE — no player config required. A standalone watcher
// finds any Kaltura player video on the page and intercepts requestPictureInPicture(), so a
// single self-hosted <script> tag enables Document PiP on any embed. If the plugin IS
// activated via config (plugins:{documentPip:{...}}), that path also runs and lets you set
// width/height.
//
// This ES-module source mirrors dist/playkit-document-pip.js (the prebuilt IIFE that is
// actually hosted). Keep the two in sync.

const LOG = '[documentPip]';
const clog = (...args) => { try { console.log(LOG, ...args); } catch (e) {} };

const SUPPORTED = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
const DEFAULT_CONFIG = { width: 400, height: 0 };

// Single shared state — Document PiP allows only one window at a time.
const state = { pipWindow: null, placeholder: null, root: null, savedCss: null };

// Resolve the FULL player wrapper (.playkit-player), not the inner video-only container.
// getView() returns .playkit-container (video only); the control bar AND overlay plugins
// (e.g. the watermark) live in .playkit-player one level up, so we move that wrapper.
function resolveRoot(video) {
  if (video && video.closest) {
    const wrapper = video.closest('.playkit-player');
    if (wrapper) {
      let outer = wrapper;
      let p = wrapper.parentElement;
      while (p) {
        if (p.classList && p.classList.contains('playkit-player')) outer = p;
        p = p.parentElement;
      }
      return outer;
    }
  }
  return video ? video.parentElement : null;
}

function hijackVideo(video) {
  if (!video) return false;
  if (video.__docPipHijacked) return true;
  video.__docPipHijacked = true;
  clog('hijacking video.requestPictureInPicture on', video);
  video.requestPictureInPicture = () => {
    clog('intercepted requestPictureInPicture -> Document PiP');
    toggle(video);
    return Promise.resolve();
  };
  return true;
}

function toggle(video) {
  if (state.pipWindow) { clog('toggle: closing existing PiP window'); state.pipWindow.close(); return; }
  enter(video);
}

function enter(video) {
  if (!SUPPORTED) return;
  const root = resolveRoot(video);
  if (!root) { clog('ERROR: could not resolve player root to move into PiP'); return; }

  const cfg = video.__docPipConfig || DEFAULT_CONFIG;
  const rect = root.getBoundingClientRect();
  const width = cfg.width || Math.round(rect.width) || 400;
  const height = cfg.height || Math.round(width * 9 / 16);
  clog('requesting PiP window', width + 'x' + height);

  window.documentPictureInPicture.requestWindow({ width, height })
    .then((pipWindow) => {
      state.pipWindow = pipWindow;
      state.root = root;
      copyStyles(pipWindow.document);

      const resetStyle = pipWindow.document.createElement('style');
      resetStyle.textContent = 'html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden;}';
      pipWindow.document.head.appendChild(resetStyle);

      state.placeholder = document.createElement('div');
      state.placeholder.style.display = 'none';
      root.parentNode.insertBefore(state.placeholder, root);

      state.savedCss = root.style.cssText;
      root.style.width = '100%';
      root.style.height = '100%';

      pipWindow.document.body.appendChild(root);
      clog('moved player root into PiP window (100% x 100%) — watermark rides along');

      pipWindow.addEventListener('pagehide', onUnload);
    })
    .catch((e) => clog('requestWindow failed (needs user gesture / one window at a time):', e));
}

function onUnload() {
  if (state.placeholder && state.placeholder.parentNode && state.root) {
    state.placeholder.parentNode.insertBefore(state.root, state.placeholder);
    state.placeholder.remove();
    if (typeof state.savedCss === 'string') { state.root.style.cssText = state.savedCss; }
    clog('PiP closed — player restored to page');
  }
  state.placeholder = null;
  state.pipWindow = null;
  state.root = null;
  state.savedCss = null;
}

function copyStyles(targetDoc) {
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) =>
    targetDoc.head.appendChild(node.cloneNode(true)));
  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i];
    try {
      const cssText = Array.prototype.map.call(sheet.cssRules, (r) => r.cssText).join('\n');
      const styleEl = targetDoc.createElement('style');
      styleEl.textContent = cssText;
      targetDoc.head.appendChild(styleEl);
    } catch (e) { /* cross-origin sheet — skip */ }
  }
}

// Standalone watcher — makes a script-tag-only embed work with NO config.
let watching = false;
function startWatch() {
  if (watching) return;
  watching = true;
  if (!SUPPORTED) { clog('Document PiP NOT supported in this browser — watcher inert.'); return; }

  const scan = () => {
    const vids = document.querySelectorAll('video');
    for (let i = 0; i < vids.length; i++) {
      const v = vids[i];
      if (v.__docPipHijacked) continue;
      if (v.closest && v.closest('.playkit-player')) hijackVideo(v);
    }
  };
  scan();

  let attempts = 0;
  const timer = setInterval(() => { attempts++; scan(); if (attempts > 120) clearInterval(timer); }, 250);

  if (typeof MutationObserver !== 'undefined') {
    const obs = new MutationObserver(scan);
    obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
    clog('watching page for Kaltura player videos');
  }
}

// Optional plugin path — activated via config, lets you pass width/height per player.
function register() {
  if (!window.KalturaPlayer || !KalturaPlayer.core || !KalturaPlayer.core.BasePlugin) return false;
  const { BasePlugin } = KalturaPlayer.core;

  class DocumentPip extends BasePlugin {
    static get defaultConfig() { return DEFAULT_CONFIG; }
    static isValid() {
      if (!SUPPORTED) clog('Document PiP NOT supported in this browser — plugin inert.');
      return SUPPORTED;
    }
    constructor(name, player, config) { super(name, player, config); clog('plugin instance created'); }

    loadMedia() {
      clog('loadMedia fired (config-activated path)');
      const apply = () => {
        let v = null;
        try { v = this.player.getVideoElement && this.player.getVideoElement(); } catch (e) {}
        if (!v && typeof this.player.getView === 'function') {
          const view = this.player.getView();
          v = view && view.querySelector ? view.querySelector('video') : null;
        }
        if (v) { v.__docPipConfig = this.config || DEFAULT_CONFIG; hijackVideo(v); return true; }
        return false;
      };
      if (!apply()) {
        let n = 0;
        const t = setInterval(() => { n++; if (apply() || n > 60) clearInterval(t); }, 250);
      }
    }

    reset() { if (state.pipWindow) { try { state.pipWindow.close(); } catch (e) {} } }
    destroy() { this.reset(); }
  }

  KalturaPlayer.core.registerPlugin('documentPip', DocumentPip);
  clog('registered plugin "documentPip" (v1.4.0)');
  return true;
}

// Boot: always start the watcher; also register as a plugin when player core is present.
startWatch();
if (!register()) {
  clog('KalturaPlayer core not present yet — retrying plugin registration (watcher already active)');
  let regAttempts = 0;
  const regTimer = setInterval(() => { regAttempts++; if (register() || regAttempts > 100) clearInterval(regTimer); }, 100);
}
