/*!
 * playkit-document-pip v1.4.0
 * Kaltura Player V7 (Playkit) plugin: routes the player's Picture-in-Picture action to
 * Document Picture-in-Picture so overlay plugins (e.g. a dynamic watermark) are preserved
 * in the floating window.
 *
 * v1.4.0: works from a SCRIPT TAG ALONE — no player config required. A standalone watcher
 * finds any Kaltura player video on the page and intercepts requestPictureInPicture(), so a
 * single self-hosted <script> tag enables Document PiP on any embed (explicit setup, auto/
 * dynamic embed, MediaSpace, etc.). If the plugin IS activated via config (plugins:{documentPip:
 * {...}}), that path still runs and lets you set width/height. Verbose logs under "[documentPip]".
 *
 * PREBUILT — no build step. Host over HTTPS with permissive CORS; references global KalturaPlayer
 * only when present (the watcher works without it).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var LOG = '[documentPip]';
  function clog() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(LOG);
      console.log.apply(console, args);
    } catch (e) { /* no-op */ }
  }

  var SUPPORTED = 'documentPictureInPicture' in window;
  var DEFAULT_CONFIG = { width: 400, height: 0 };

  // Single shared state — Document PiP allows only one window at a time.
  var state = { pipWindow: null, placeholder: null, root: null, savedCss: null };

  // ---------------------------------------------------------------------------
  // Core (DOM-only) — shared by the standalone watcher and the plugin path.
  // ---------------------------------------------------------------------------

  // Resolve the FULL player wrapper (.playkit-player), not the inner video-only container.
  // getView() returns .playkit-container (video engine only); the control bar AND overlay
  // plugins (e.g. the watermark) live in the .playkit-player wrapper one level up, so we
  // must move that wrapper for controls + watermark to travel into the PiP window.
  function resolveRoot(video) {
    if (video && video.closest) {
      var wrapper = video.closest('.playkit-player');
      if (wrapper) {
        var outer = wrapper;
        var p = wrapper.parentElement;
        while (p) {
          if (p.classList && p.classList.contains('playkit-player')) outer = p;
          p = p.parentElement;
        }
        return outer;
      }
    }
    return video ? video.parentElement : null;
  }

  // Replace requestPictureInPicture on a specific video so the player's PiP button opens a
  // Document PiP window instead. Idempotent via the __docPipHijacked flag.
  function hijackVideo(video) {
    if (!video) return false;
    if (video.__docPipHijacked) return true;
    video.__docPipHijacked = true;
    clog('hijacking video.requestPictureInPicture on', video);
    video.requestPictureInPicture = function () {
      clog('intercepted requestPictureInPicture -> Document PiP');
      toggle(video);
      // Resolve so the player UI does not log an unhandled rejection.
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
    var root = resolveRoot(video);
    if (!root) { clog('ERROR: could not resolve player root to move into PiP'); return; }

    var cfg = video.__docPipConfig || DEFAULT_CONFIG;
    var rect = root.getBoundingClientRect();
    var width = cfg.width || Math.round(rect.width) || 400;
    var height = cfg.height || Math.round(width * 9 / 16);
    clog('requesting PiP window', width + 'x' + height);

    window.documentPictureInPicture.requestWindow({ width: width, height: height })
      .then(function (pipWindow) {
        state.pipWindow = pipWindow;
        state.root = root;
        copyStyles(pipWindow.document);

        // Neutral layout reset only — NO player-specific class names. The PiP body fills the
        // window and the moved element is sized to fill the body, so the player lays itself
        // out for that size using its own responsive logic.
        var resetStyle = pipWindow.document.createElement('style');
        resetStyle.textContent = 'html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden;}';
        pipWindow.document.head.appendChild(resetStyle);

        state.placeholder = document.createElement('div');
        state.placeholder.style.display = 'none';
        root.parentNode.insertBefore(state.placeholder, root);

        // Preserve the element's own inline size, then make it fill the PiP window.
        state.savedCss = root.style.cssText;
        root.style.width = '100%';
        root.style.height = '100%';

        pipWindow.document.body.appendChild(root);
        clog('moved player root into PiP window (100% x 100%) — watermark rides along');

        pipWindow.addEventListener('pagehide', onUnload);
      })
      .catch(function (e) {
        clog('requestWindow failed (needs user gesture / one window at a time):', e);
      });
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
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(function (node) {
      targetDoc.head.appendChild(node.cloneNode(true));
    });
    for (var i = 0; i < document.styleSheets.length; i++) {
      var sheet = document.styleSheets[i];
      try {
        var cssText = Array.prototype.map.call(sheet.cssRules, function (r) { return r.cssText; }).join('\n');
        var styleEl = targetDoc.createElement('style');
        styleEl.textContent = cssText;
        targetDoc.head.appendChild(styleEl);
      } catch (e) { /* cross-origin sheet — skip */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Standalone watcher — makes a script-tag-only embed work with NO config.
  // Finds Kaltura player videos as they appear (and when swapped) and hijacks them.
  // ---------------------------------------------------------------------------
  var watching = false;
  function startWatch() {
    if (watching) return;
    watching = true;
    if (!SUPPORTED) { clog('Document PiP NOT supported in this browser — watcher inert.'); return; }

    function scan() {
      var vids = document.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) {
        var v = vids[i];
        if (v.__docPipHijacked) continue;
        if (v.closest && v.closest('.playkit-player')) hijackVideo(v);
      }
    }
    scan();

    // Bounded poll (~30s) covers videos created after this script runs.
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      scan();
      if (attempts > 120) clearInterval(timer);
    }, 250);

    // Long-lived observer re-hijacks videos the player swaps in (source/quality changes).
    if (typeof MutationObserver !== 'undefined') {
      var obs = new MutationObserver(scan);
      obs.observe(document.documentElement || document.body, { childList: true, subtree: true });
      clog('watching page for Kaltura player videos');
    }
  }

  // ---------------------------------------------------------------------------
  // Plugin path — optional. Registers a real Playkit plugin so it can be activated
  // via config (plugins:{documentPip:{width,height}}). Reuses the same core above;
  // its only added value over the watcher is passing width/height through config.
  // ---------------------------------------------------------------------------
  function register() {
    if (!window.KalturaPlayer || !KalturaPlayer.core || !KalturaPlayer.core.BasePlugin) {
      return false;
    }
    var BasePlugin = KalturaPlayer.core.BasePlugin;

    function DocumentPip(name, player, config) {
      BasePlugin.call(this, name, player, config);
      clog('plugin instance created');
    }
    DocumentPip.prototype = Object.create(BasePlugin.prototype);
    DocumentPip.prototype.constructor = DocumentPip;

    Object.defineProperty(DocumentPip, 'defaultConfig', { get: function () { return DEFAULT_CONFIG; } });

    // Per Kaltura docs the signature is isValid(player); we gate on Document PiP support.
    DocumentPip.isValid = function () {
      if (!SUPPORTED) clog('Document PiP NOT supported in this browser — plugin inert.');
      return SUPPORTED;
    };

    DocumentPip.prototype.loadMedia = function () {
      clog('loadMedia fired (config-activated path)');
      var self = this;
      var apply = function () {
        var v = null;
        try { v = self.player.getVideoElement && self.player.getVideoElement(); } catch (e) {}
        if (!v && typeof self.player.getView === 'function') {
          var view = self.player.getView();
          v = view && view.querySelector ? view.querySelector('video') : null;
        }
        if (v) {
          // Stash config on the video so enter() can honor width/height for THIS player.
          v.__docPipConfig = self.config || DEFAULT_CONFIG;
          hijackVideo(v);
          return true;
        }
        return false;
      };
      if (!apply()) {
        var n = 0;
        var t = setInterval(function () { n++; if (apply() || n > 60) clearInterval(t); }, 250);
      }
    };

    DocumentPip.prototype.reset = function () {
      if (state.pipWindow) { try { state.pipWindow.close(); } catch (e) {} }
    };
    DocumentPip.prototype.destroy = function () { this.reset(); };

    KalturaPlayer.core.registerPlugin('documentPip', DocumentPip);
    clog('registered plugin "documentPip" (v1.4.0)');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Boot: always start the watcher (script-tag-only path). Also register as a
  // plugin when the player core is present (enables config-driven width/height).
  // ---------------------------------------------------------------------------
  startWatch();

  if (!register()) {
    clog('KalturaPlayer core not present yet — retrying plugin registration (watcher already active)');
    var regAttempts = 0;
    var regTimer = setInterval(function () {
      regAttempts++;
      if (register() || regAttempts > 100) clearInterval(regTimer);
    }, 100);
  }
})();
