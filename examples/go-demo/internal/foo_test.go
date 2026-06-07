// Package internal exercises the kensho Go helper across the full surface
// the converter understands: severity, behavior, labels, links, steps,
// attachments, sub-tests, table-driven tests, panics, and skips.
package internal

import (
	"fmt"
	"strings"
	"testing"

	kensho "github.com/kaizenreport/kensho-go-helper"
)

func TestLoginHappyPath(t *testing.T) {
	kensho.Severity(t, "critical")
	kensho.Feature(t, "Authentication")
	kensho.Epic(t, "User onboarding")
	kensho.Label(t, "team", "growth")
	kensho.Label(t, "surface", "web")
	kensho.Link(t, "https://jira.example.com/browse/PROJ-123",
		kensho.LinkOpts{Kind: "jira", Label: "PROJ-123"})

	t.Logf("about to call backend")
	kensho.Step(t, "open the login page", func() {
		kensho.Step(t, "warm up CDN", func() {
			if 1+1 != 2 {
				t.Fatal("math is broken")
			}
		})
	})
	kensho.Step(t, "submit credentials", func() {
		if !strings.HasPrefix("ok", "o") {
			t.Fatal("unreachable")
		}
	})
}

func TestCartTotalIsWrong(t *testing.T) {
	kensho.Severity(t, "blocker")
	kensho.Feature(t, "Cart")

	prices := []int{10, 20}
	total := 0
	for _, p := range prices {
		total += p
	}
	// Intentional failure — sums to 30 not 40.
	if total != 40 {
		t.Errorf("cart total mismatch: got %d, want 40", total)
	}
}

func TestPromoCodes(t *testing.T) {
	kensho.Severity(t, "minor")
	t.Skip("feature not enabled in this environment")
}

func TestSearchReturnsExpectedCount(t *testing.T) {
	kensho.Feature(t, "Search")

	cases := []struct {
		name     string
		query    string
		expected int
	}{
		{"common", "widgets", 3},
		{"rare", "gadgets", 5},
		{"empty", "doodads", 0},
	}

	fakeDB := map[string]int{"widgets": 3, "gadgets": 5, "doodads": 0}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			kensho.Parameter(t, "query", tc.query)
			kensho.Parameter(t, "expected_count", fmt.Sprintf("%d", tc.expected))
			if got := fakeDB[tc.query]; got != tc.expected {
				t.Errorf("got %d, want %d", got, tc.expected)
			}
		})
	}
}

func TestPanicsAreFails(t *testing.T) {
	kensho.Tag(t, "regression")
	defer func() {
		// Catch the panic so `go test` reports a fail, not a crash. The
		// converter still maps panic-bearing failures to status 'fail'
		// because the captured output contains "panic:".
		if r := recover(); r != nil {
			t.Errorf("panic recovered: %v", r)
		}
	}()
	var s []int
	_ = s[5] // panic: index out of range
}
