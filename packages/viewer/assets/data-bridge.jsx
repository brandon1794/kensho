// ============================================================
// Kensho viewer — data bridge (static-report adapter).
//
// Thin shim that calls the pure `loadKenshoData(...)` from src/data.js
// (the same loader the embeddable React component uses) and writes
// the result to window globals so the static-report's pre-compiled
// .js components keep working unchanged. Boot promise lives at
// window.__KENSHO_BOOT — index.html awaits it before mounting.
// ============================================================

(function () {
  // The static-report bundle inlines src/data.js below at build time. If
  // that hasn't happened (e.g. running without scripts/build.js), fall back
  // to a minimal noop so we don't crash the page silently.
  const loader = window.__KENSHO_LOAD_DATA;
  if (typeof loader !== 'function') {
    console.error('[kensho] data loader missing — was the viewer built with scripts/build.js?');
    window.__KENSHO_BOOT = Promise.reject(new Error('data loader missing'));
    return;
  }

  async function init() {
    const state = await loader('data');

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
  }

  window.__KENSHO_BOOT = init().catch(err => {
    console.error('[kensho] boot failed:', err);
    document.body.innerHTML = '<div style="font-family:sans-serif;padding:40px;color:#E5484D">' +
      '<h2>Failed to load report data</h2>' +
      '<pre style="background:#fcebec;padding:14px;border-radius:6px;">' + (err?.message || err) + '</pre>' +
      '<p>Make sure <code>data/index.json</code> exists and the report is served (not opened via file://).</p>' +
      '</div>';
  });
})();
