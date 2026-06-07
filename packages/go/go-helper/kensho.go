// Package kensho is the Go-side companion to @kaizenreport/kensho-go.
//
// It writes structured `KENSHO_META: {...}` lines via t.Logf so the Node CLI
// (`kensho-go`) can fold first-class steps, attachments, labels, and links
// into the generated report. This mirrors the helper API exposed by
// kensho-pytest, kensho-playwright, and the rest of the Kensho adapters.
//
// Example:
//
//	import (
//	    "testing"
//	    kensho "github.com/kaizenreport/kensho-go-helper"
//	)
//
//	func TestLogin(t *testing.T) {
//	    kensho.Severity(t, "critical")
//	    kensho.Feature(t, "Authentication")
//	    kensho.Label(t, "team", "growth")
//	    kensho.Link(t, "https://jira.example.com/browse/PROJ-123",
//	        kensho.LinkOpts{Kind: "jira", Label: "PROJ-123"})
//
//	    kensho.Step(t, "open the login page", func() {
//	        // …
//	    })
//	    kensho.Attach(t, "/tmp/screenshot.png", kensho.AttachOpts{Kind: "screenshot"})
//	}
//
// The helper writes nothing to stdout — only structured tag lines via t.Logf.
// All functions are no-ops when t is nil so test utilities can be shared with
// non-test code without a separate code path.
package kensho

import (
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"
)

// LinkOpts carries optional fields for Link.
type LinkOpts struct {
	Kind  string // "jira" | "github" | "runbook" | …
	Label string // human label displayed on the chip
}

// AttachOpts carries optional fields for Attach.
type AttachOpts struct {
	Name     string // override destination filename
	Kind     string // schema attachment kind override (screenshot, video, log, …)
	MimeType string // MIME type override
}

// ParameterOpts carries optional fields for Parameter.
type ParameterOpts struct {
	Kind string // "argument" | "context" | "env" | "data-row"
}

var stepCounter uint64

// Severity records the case severity (blocker | critical | normal | minor | trivial).
func Severity(t testing.TB, value string) {
	emit(t, map[string]any{"kind": "severity", "value": value})
}

// Tag attaches a free-form tag to the case.
func Tag(t testing.TB, value string) {
	emit(t, map[string]any{"kind": "tag", "value": value})
}

// Feature records the behavior feature (e.g. "Authentication").
func Feature(t testing.TB, value string) {
	emit(t, map[string]any{"kind": "feature", "value": value})
}

// Epic records the behavior epic.
func Epic(t testing.TB, value string) {
	emit(t, map[string]any{"kind": "epic", "value": value})
}

// Scenario records the behavior scenario.
func Scenario(t testing.TB, value string) {
	emit(t, map[string]any{"kind": "scenario", "value": value})
}

// Label sets a free-form key/value on the case.
func Label(t testing.TB, key, value string) {
	emit(t, map[string]any{"kind": "label", "key": key, "value": value})
}

// Link attaches a hyperlink (Jira ticket, runbook, PR…) to the case.
func Link(t testing.TB, url string, opts ...LinkOpts) {
	rec := map[string]any{"kind": "link", "url": url}
	if len(opts) > 0 {
		o := opts[0]
		if o.Kind != "" {
			rec["linkKind"] = o.Kind
		}
		if o.Label != "" {
			rec["label"] = o.Label
		}
	}
	emit(t, rec)
}

// Parameter records a test parameter (e.g. table-driven inputs).
func Parameter(t testing.TB, name, value string, opts ...ParameterOpts) {
	rec := map[string]any{"kind": "parameter", "name": name, "value": value}
	if len(opts) > 0 && opts[0].Kind != "" {
		rec["paramKind"] = opts[0].Kind
	}
	emit(t, rec)
}

// Attach registers a file to be copied into kensho-results/attachments/<caseId>/
// at conversion time. The file path must exist on disk when `kensho-go` runs.
func Attach(t testing.TB, path string, opts ...AttachOpts) {
	rec := map[string]any{"kind": "attach", "path": path}
	if len(opts) > 0 {
		o := opts[0]
		if o.Name != "" {
			rec["name"] = o.Name
		}
		if o.Kind != "" {
			rec["kind"] = "attach" // keep schema kind in attach-record below
			rec["attachKind"] = o.Kind
		}
		if o.MimeType != "" {
			rec["mimeType"] = o.MimeType
		}
	}
	// The Node CLI reads `kind: attach` and falls back to a sensible default
	// for the on-disk attachment kind; AttachOpts.Kind is forwarded as
	// `attachKind` so we can keep the meta envelope's `kind` discriminator
	// stable.
	emit(t, rec)
}

// Step opens a Kensho step around fn. Steps may be nested by calling Step
// inside fn. If fn panics or marks the test as failed, the step is recorded
// with status `fail`.
func Step(t testing.TB, title string, fn func()) {
	if t == nil {
		if fn != nil {
			fn()
		}
		return
	}
	id := fmt.Sprintf("s%d", atomic.AddUint64(&stepCounter, 1))
	emit(t, map[string]any{
		"kind":  "step_start",
		"id":    id,
		"title": title,
		"t":     time.Now().UnixMilli(),
	})

	status := "pass"
	failed := false
	defer func() {
		if r := recover(); r != nil {
			status = "fail"
			emit(t, map[string]any{
				"kind":   "step_end",
				"id":     id,
				"status": status,
				"t":      time.Now().UnixMilli(),
			})
			panic(r)
		}
		if failed || t.Failed() {
			status = "fail"
		}
		emit(t, map[string]any{
			"kind":   "step_end",
			"id":     id,
			"status": status,
			"t":      time.Now().UnixMilli(),
		})
	}()

	if fn != nil {
		fn()
	}
	if t.Failed() {
		failed = true
	}
}

// emit writes the meta record. We use t.Logf so it's interleaved with the
// surrounding test output; the Node CLI parses any line starting with
// "KENSHO_META:" out of the captured stream.
func emit(t testing.TB, rec map[string]any) {
	if t == nil {
		return
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return
	}
	t.Helper()
	// Newline is added by t.Logf; the prefix is what the converter looks for.
	t.Logf("KENSHO_META: %s", string(b))
}
