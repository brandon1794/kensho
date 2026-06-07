// Type declarations for @kaizenreport/kensho-viewer/component.
//
// Hand-written; the implementation is JSX. Kept minimal — covers the public
// API only.

import type * as React from 'react';

export interface KenshoSidebarItem {
  /** Stable key, used for React reconciliation. */
  id: string;
  /** Visible label. */
  label: string;
  /** Lucide icon name (https://lucide.dev/icons). */
  icon: string;
  /** Render the page body when this item is active. */
  render: () => React.ReactNode;
}

export interface KenshoExtraTab {
  /** Stable key, used for React reconciliation. */
  id: string;
  /** Visible tab label. */
  label: string;
  /** Render the tab body for the given test (`RichTest` shape). */
  render: (test: any) => React.ReactNode;
}

export interface KenshoViewerProps {
  /**
   * URL to a Kensho `data/` directory. The component will fetch
   * `${dataUrl}/index.json` and (lazily) `${dataUrl}/cases/<id>.json`.
   * Trailing slashes are normalized.
   */
  dataUrl: string;

  /**
   * Override for per-case JSON URLs. Default: `${dataUrl}/cases/<id>.json`.
   */
  caseUrl?: (caseId: string) => string;

  /**
   * URL to the directory containing the viewer's compiled `assets/*.js`
   * files. Required if you don't drop a `<link data-kensho-viewer-assets="…">`
   * marker in your <head>.
   */
  assetsUrl?: string;

  /** Fired when a case is opened (deep-link integration). */
  onCaseOpen?: (caseId: string | null) => void;

  /** Fired when the user navigates to a different sidebar page. */
  onPageChange?: (page: string) => void;

  /**
   * Optional extra sidebar items rendered after the built-ins.
   */
  extraSidebar?: KenshoSidebarItem[];

  /**
   * Optional extra tabs injected at the end of the test detail tab list.
   */
  extraTabs?: KenshoExtraTab[];

  /**
   * Initial state — useful for SSR / deep-linked URLs.
   */
  initial?: {
    page?: string;
    caseId?: string;
  };

  /**
   * When `true`, the viewer suppresses its own hash-router and keyboard
   * shortcuts. The host must update `initial.page` / `initial.caseId` (or
   * remount) in response to the `onPageChange` / `onCaseOpen` callbacks.
   */
  ownKeyboard?: boolean;
}

export declare function KenshoViewer(props: KenshoViewerProps): JSX.Element;
export default KenshoViewer;

/**
 * Pure data loader — fetches `${dataUrl}/index.json` and normalizes the
 * Kensho v1 schema into the shape the viewer expects. Exposed for hosts that
 * want to introspect the loaded data themselves.
 */
export declare function loadKenshoData(
  dataUrl: string,
  opts?: {
    caseUrl?: (caseId: string) => string;
    fetch?: typeof fetch;
  }
): Promise<KenshoState>;

export interface KenshoState {
  kenshoIndex: any;
  reportType: 'unit' | 'e2e' | 'mixed' | string;
  run: any;
  env: Array<[string, string]>;
  suites: Array<{ name: string; segs: Array<{ k: string; n: number }>; total: number }>;
  tests: any[];
  richTests: Record<string, any>;
  suiteTree: any[];
  behaviorTree: any[];
  categories: any[];
  timelineTests: any[];
  trendRuns: any[];
  histogram: Array<{ label: string; n: number }>;
  historyRuns: any[];
  ensureCaseLoaded: (richTest: any) => Promise<any>;
  loadCase: (id: string) => Promise<any>;
  fmtDuration: (ms: number) => string;
  relTime: (iso: string) => string;
}
