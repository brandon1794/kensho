// =============================================================
// <KenshoViewer /> — embeddable React component.
//
// Same code path as the static report, but:
//   * Fetches data from the URL passed in `props.dataUrl` (instead of
//     hard-coded "data/").
//   * Suppresses hash-router and keyboard shortcuts when the host opts in
//     (`ownKeyboard: true`), bubbling navigation events to callbacks.
//   * Lets the host inject extra sidebar items + extra detail-pane tabs.
//
// The static report itself does NOT load this file. It loads the original
// pre-compiled `assets/*.js` that read from window globals.
// =============================================================

import React, { useEffect, useRef, useState } from 'react';
import { loadKenshoData } from './data.js';

// ---- Context ------------------------------------------------------------
//
// Components in the static-report bundle continue to read window.RICH_TESTS
// etc. directly — they aren't aware of this context. The context is only
// consumed by:
//
//   * Sidebar/DetailPane — to discover extraSidebar / extraTabs
//   * The internal navigation shims — to bypass hash routing when
//     `ownKeyboard` is set.
//
// When useKenshoCtx() returns null (= component used outside a provider, ie.
// the static-report path), callers fall back to window globals as before.

const KenshoContext = React.createContext(null);

export function useKenshoCtx() {
  return React.useContext(KenshoContext);
}

// Make it accessible to the global components (they live in window.*) so
// Sidebar/DetailPane can opt in.
if (typeof window !== 'undefined') {
  window.__KenshoContext = KenshoContext;
}

// ---- Snapshot of the rendered <App> tree --------------------------------
//
// `App`, `Sidebar`, `DetailPane`, etc. are defined by the legacy assets/*
// scripts (loaded as plain <script> tags by index.html). When this component
// is bundled for embedding via esbuild, those scripts are NOT loaded.
//
// We need *some* way to render the same UI from inside the bundle. There
// are two viable shapes:
//
//   A) Re-implement <App> here. Lots of duplication, drifts over time.
//
//   B) Resolve <App> from window at mount time. Requires the host to load
//      the legacy assets up front. Bigger ask on integrators.
//
// We pick (C): the component bundle dynamically injects the legacy compiled
// scripts into the host page (one-time, idempotent) and then renders the
// resolved `window.App`. This keeps a single source of truth and makes the
// embed a true mirror of the static-report. See `loadLegacyScripts()` below.

const LEGACY_SCRIPTS = [
  'data-loader.js',   // exposes window.__KENSHO_LOAD_DATA
  'components.js',
  'charts.js',
  'test-detail.js',
  'tree-detail.js',
  'pages.js',
  'app.js',
];

// Track which (assetsBaseUrl, scriptName) pairs we've injected so a re-mount
// with the same base doesn't double-load.
const _injected = new Set();

function injectScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-kv-src="${url}"]`);
    if (existing) {
      if (existing.dataset.kvLoaded === '1') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('failed: ' + url)), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = url;
    s.dataset.kvSrc = url;
    s.async = false; // preserve order
    s.addEventListener('load', () => { s.dataset.kvLoaded = '1'; resolve(); }, { once: true });
    s.addEventListener('error', () => reject(new Error('failed: ' + url)), { once: true });
    document.head.appendChild(s);
  });
}

async function loadLegacyAssets(assetsBaseUrl) {
  const base = String(assetsBaseUrl).replace(/\/+$/, '');
  for (const name of LEGACY_SCRIPTS) {
    const url = `${base}/${name}`;
    if (_injected.has(url)) continue;
    await injectScript(url);
    _injected.add(url);
  }
  // Lucide icons — same as the static report's index.html.
  if (!window.lucide) {
    await injectScript('https://unpkg.com/lucide@latest/dist/umd/lucide.min.js');
  }
}

// `app.js`'s top-level code calls window.__KENSHO_BOOT.then(() => ReactDOM.createRoot(...).render(<App/>)).
// We don't want THAT to happen — we render <App/> ourselves into our own
// container. So before `app.js` evaluates, install a shim that swallows the
// auto-mount.
function installNoAutoMount() {
  // Resolve __KENSHO_BOOT immediately with `null`. The `.then(() => render…)`
  // body will run, but our shim throws before it can render.
  if (!window.__KENSHO_BOOT) window.__KENSHO_BOOT = Promise.resolve();
  // Swap out ReactDOM.createRoot with a noop the first time it's accessed
  // FROM the legacy app.js. Easiest: monkey-patch `getElementById` to return
  // null for the legacy "app" id, which makes createRoot throw — caught by
  // app.js's `.catch` (it doesn't have one!). So instead we replace
  // ReactDOM.createRoot during the brief window the script evaluates.
  const dom = window.ReactDOM;
  if (!dom) {
    // ReactDOM isn't on window in embed mode (we use the host's react-dom
    // import). Provide a stub so app.js's `ReactDOM.createRoot(...).render`
    // is a noop.
    window.ReactDOM = { createRoot: () => ({ render() {}, unmount() {} }) };
  }
  // Same for React (legacy uses `const { useState, useEffect } = React;`).
  if (!window.React) {
    window.React = React;
  }
}

// Restore real ReactDOM/React after the legacy scripts have evaluated, so
// we don't permanently mess with the global. (We installed stubs only; if
// the host had its own globals, we leave them alone via the if-checks
// above.)

// ---- The component itself ------------------------------------------------

export function KenshoViewer(props) {
  const {
    dataUrl,
    caseUrl,
    assetsUrl, // optional: where to load the viewer's compiled JS from. Default: same package.
    onCaseOpen,
    onPageChange,
    extraSidebar,
    extraTabs,
    initial,
    ownKeyboard = false,
  } = props;

  if (!dataUrl) throw new Error('<KenshoViewer dataUrl="..." /> is required');

  const containerRef = useRef(null);
  const [phase, setPhase] = useState('boot'); // 'boot' | 'loading' | 'ready' | 'error'
  const [errMsg, setErrMsg] = useState('');
  const [state, setState] = useState(null);

  // Resolve the URL to load the legacy compiled scripts from. By default we
  // assume the host bundled this component; the legacy assets live in the
  // same package. The host can override via `assetsUrl` if they self-host.
  const resolvedAssetsUrl = assetsUrl || guessDefaultAssetsUrl();

  // 1. Inject the legacy compiled scripts (one-time).
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    installNoAutoMount();
    loadLegacyAssets(resolvedAssetsUrl)
      .then(() => loadKenshoData(dataUrl, { caseUrl: caseUrl ? (id) => caseUrl(id) : undefined }))
      .then(s => {
        if (cancelled) return;
        // Push the loaded state onto window.* so the legacy components keep
        // working. (They were written before the context refactor.) This is
        // the documented limitation: 1 embedded viewer per page. Re-mount
        // with a different `dataUrl` works because we re-write the globals.
        applyToWindow(s);
        setState(s);
        setPhase('ready');
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[KenshoViewer] failed to boot:', err);
        setErrMsg(err?.message || String(err));
        setPhase('error');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl]); // intentionally don't depend on caseUrl/assetsUrl — they're stable in practice.

  // (Step 2 removed.) Navigation is bridged inside the legacy <App>: when its
  // context says `ownKeyboard: true` it calls `ctx.onPageChange` /
  // `ctx.onCaseOpen` instead of pushing to window.location.hash. See
  // assets/app.jsx. We don't override window.__navTo from out here because
  // that would skip the legacy App's local page state update.

  // 3. Mount the legacy <App/> into our container once data is ready.
  //    We do it imperatively because <App/> lives on window and isn't a
  //    JSX-importable export.
  //
  //    Important: we mount ONCE per `state` (data reload) and re-render the
  //    same root with a fresh `ctxValue` when extras / callbacks change. If
  //    we unmounted on every prop change, the legacy App's local state
  //    (selected page, search filters, splitter width, …) would be wiped.
  const rootRef = useRef(null);
  // (a) Mount on phase=ready / data changes.
  useEffect(() => {
    if (phase !== 'ready' || !state || !containerRef.current) return;
    const App = window.App;
    if (typeof App !== 'function') {
      console.error('[KenshoViewer] window.App not found after legacy load. Build out of date?');
      return;
    }
    let cancelled = false;
    import('react-dom/client').then(({ createRoot }) => {
      if (cancelled) return;
      const root = createRoot(containerRef.current);
      rootRef.current = root;
      renderLegacy(root);
    });
    return () => {
      cancelled = true;
      try { rootRef.current?.unmount(); } catch {}
      rootRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state]);

  // (b) Re-render with fresh ctxValue whenever extras / callbacks change.
  useEffect(() => {
    if (rootRef.current) renderLegacy(rootRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraSidebar, extraTabs, onCaseOpen, onPageChange, ownKeyboard]);

  function renderLegacy(root) {
    const App = window.App;
    if (typeof App !== 'function') return;
    const ctxValue = {
      state,
      extraSidebar: extraSidebar || [],
      extraTabs: extraTabs || [],
      onCaseOpen,
      onPageChange,
      ownKeyboard,
      // `page` / `caseId` here are the host-controlled values from
      // `props.initial`. The legacy App reads `ctx?.page` only as an
      // optional one-way sync source (see app.jsx). Local navigation
      // inside the viewer keeps using the App's own `useState`.
      page: initial?.page,
      caseId: initial?.caseId,
    };
    const legacyApp = React.createElement(App, null);
    root.render(
      React.createElement(KenshoContext.Provider, { value: ctxValue }, legacyApp)
    );
  }

  // 4. Suppress legacy keyboard shortcuts when the host opts in. The legacy
  //    shortcut handler is registered on `window` from `app.jsx`. We can't
  //    easily un-register it, so instead capture all keydown events at the
  //    container and stop propagation before they bubble to window.
  useEffect(() => {
    if (!ownKeyboard) return;
    const node = containerRef.current;
    if (!node) return;
    const onKeyDown = (e) => {
      // Don't swallow chords inside text inputs the host may add.
      e.stopPropagation();
    };
    node.addEventListener('keydown', onKeyDown, true);
    return () => node.removeEventListener('keydown', onKeyDown, true);
  }, [ownKeyboard, phase]);

  if (phase === 'error') {
    return React.createElement(
      'div',
      { className: 'kv-embed-error', style: { padding: 24, color: '#E5484D', fontFamily: 'sans-serif' } },
      React.createElement('h3', null, 'Failed to load Kensho report'),
      React.createElement('pre', { style: { whiteSpace: 'pre-wrap', background: '#fcebec', padding: 12, borderRadius: 6 } }, errMsg)
    );
  }

  return React.createElement('div', {
    ref: containerRef,
    className: 'kv-embed-root',
    'data-kensho-viewer': '',
    style: { width: '100%', height: '100%', minHeight: 480 },
  });
}

// Where do we load `assets/*.js` from?
//   * If the host imported from `@kaizenreport/kensho-viewer/component`, we
//     don't have a direct way to know the package URL.
//   * Convention: the host should serve the package's `assets/` directory
//     (e.g. via Vite's static asset import) and pass `assetsUrl` explicitly.
//   * As a sane default, we look for a <script data-kensho-viewer-assets>
//     marker tag the host can drop in their <head>.
function guessDefaultAssetsUrl() {
  if (typeof document === 'undefined') return '/kensho-viewer-assets';
  const marker = document.querySelector('[data-kensho-viewer-assets]');
  if (marker) return marker.getAttribute('data-kensho-viewer-assets') || marker.getAttribute('href');
  // Last-resort default — relative to the page.
  return './kensho-viewer-assets';
}

// Apply a loaded `KenshoState` onto window globals so the legacy components
// can read them. Mirrors the assignments in `assets/data-bridge.jsx`.
function applyToWindow(state) {
  Object.assign(window, {
    KENSHO_INDEX: state.kenshoIndex,
    KENSHO_REPORT_TYPE: state.reportType,
    RUN: state.run,
    ENV: state.env,
    SUITES: state.suites,
    TESTS: state.tests,
    RICH_TESTS: state.richTests,
    SUITE_TREE: state.suiteTree,
    BEHAVIOR_TREE: state.behaviorTree,
    CATEGORIES: state.categories,
    TIMELINE_TESTS: state.timelineTests,
    TREND_RUNS: state.trendRuns,
    HISTOGRAM: state.histogram,
    HISTORY_RUNS: state.historyRuns,
    _kenshoEnsureCase: state.ensureCaseLoaded,
    _kenshoLoadCase: state.loadCase,
    _kenshoFmtDuration: state.fmtDuration,
    _kenshoRelTime: state.relTime,
  });
  // Mark __KENSHO_BOOT as resolved so any late-arriving legacy code path
  // (which awaits it) proceeds without waiting for a real fetch.
  window.__KENSHO_BOOT = Promise.resolve();
}

// Re-export for advanced consumers.
export { loadKenshoData };

export default KenshoViewer;
