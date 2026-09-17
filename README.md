# playkit-js-document-pip

A self-hosted script that upgrades the Kaltura Player **V7 (Playkit)** Picture-in-Picture
action to **Document Picture-in-Picture**.

Native PiP hands only the video's pixel buffer to the Chromium mini-player, so all Kaltura
Player overlays are dropped. This could include Kaltura's AI Genie, summary & chapters, dynamic
watermarks, and more. Document PiP instead opens a real, always-on-top browser window that hosts
an HTML document, so this script moves the **entire player view** — video, control bar, and
every overlay — into it. Everything renders and keeps updating as it does on the page, and the
window stays on top when the user switches tabs or apps.

It works from a **single self-hosted `<script>` tag with no player config**. A standalone
watcher finds any Kaltura player video on the page and intercepts `requestPictureInPicture()`,
so loading the file once — site-wide via MediaSpace — is enough to enable Document PiP on every
player.

---

## What's in here

- `dist/playkit-document-pip.js` — the **prebuilt IIFE bundle you host** (browser-ready, no
  build step, references global `KalturaPlayer` only when present).
- `src/document-pip.js` — ES-module source, kept in sync with the dist bundle.
- `webpack.config.js` / `package.json` — optional build tooling (not required to use dist).

---

## 1. Host the bundle

Upload `dist/playkit-document-pip.js` to any HTTPS location the player pages can reach (a CDN,
static host, or the existing GitHub Pages URL). Note the full URL, e.g.
`https://your-cdn.example.com/playkit/playkit-document-pip.js`.

> If you edit the source, rebuild with `npm install && npm run build` (output goes to
> `dist/playkit-document-pip.js`). The bundle deliberately does **not** include the player
> core — it references the global `KalturaPlayer` the player provides at runtime.

## 2. Load it site-wide in MediaSpace (KMS)

In the KMS admin (`https://<partner>.mediaspace.kaltura.com/admin`), open the **Application**
module and find the **`headerJSlinks`** field ("Enter links to JS files to be loaded on all KMS
headers"). Click **+ Add "headerJSlinks"** and paste the bundle URL:

```
https://your-cdn.example.com/playkit/playkit-document-pip.js?v=1.4.0
```

Then scroll to the bottom and **Save**. This loads the file in the `<head>` of every KMS page,
and the watcher self-activates — no per-page edits and no player config required. Every
MediaSpace player gets Document PiP.

> **Which field:** use `headerJSlinks` (loads an external JS file by URL) — **not** `headerJS`
> (a box for raw inline JavaScript) or `bodyJS` (inline JS at page bottom). Note the field's own
> warning: these do **not** run on `/admin` pages — that's fine, you only need it on the
> viewer/player pages, which are covered.

> **Cache note:** since this loads on every page, bump the `?v=` number in the `headerJSlinks`
> field whenever you deploy a new build, or KMS pages keep serving the cached bundle (GitHub
> Pages caches ~10 min).

## 3. Verify

On a normal MediaSpace video page (not `/admin`), open DevTools and confirm the console prints
`[documentPip] watching page for Kaltura player videos` on load and, on play,
`hijacking video.requestPictureInPicture`. Click the PiP button — the player should pop into a
floating, always-on-top window with all overlays intact.

---

## How it works (for review)

1. **Support gate:** if `documentPictureInPicture` is absent (non-Chromium), the watcher stays
   inert and native PiP is untouched — no errors.
2. **Standalone watcher:** scans the page for `<video>` elements inside a `.playkit-player` and
   overrides `requestPictureInPicture()` on each to open Document PiP instead. A bounded poll +
   `MutationObserver` catch videos created or swapped later.
3. **On PiP:** resolves the full `.playkit-player` wrapper (not the video-only
   `.playkit-container`), copies the page's stylesheets into the new document, leaves a
   placeholder, sizes the wrapper to fill the window, and `appendChild`s it into the PiP
   window — so video, controls, and every overlay travel together.
4. **On `pagehide`:** moves the player back to the placeholder and restores its inline styles.

---

## Browser support

Chromium (Chrome/Edge) 116+. Not supported in Safari or Firefox as of this writing —
verify current support before rollout if that ever changes. On unsupported browsers users
simply get native PiP (or no PiP) — no errors.
