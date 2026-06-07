// auth-config — read/write the persisted CLI auth file.
//
// On Linux/macOS we honor $XDG_CONFIG_HOME (falling back to ~/.config).
// macOS users sometimes prefer ~/Library/Application Support/kensho but the
// XDG path is what every other tool we ship reaches for, so we stick with it.
// File is `~/.config/kensho/auth.json` with mode 0600.

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export function authDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) return join(xdg, 'kensho');
  return join(homedir(), '.config', 'kensho');
}

export function authPath() {
  return join(authDir(), 'auth.json');
}

/**
 * Load the persisted auth file. Returns `null` if the file is missing or
 * unreadable; never throws — callers fall back to env vars / flags.
 *
 * @returns {{ workspace: string, token: string, server: string } | null}
 */
export function loadAuth() {
  const p = authPath();
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    if (!data.token || typeof data.token !== 'string') return null;
    return {
      workspace: typeof data.workspace === 'string' ? data.workspace : '',
      token: data.token,
      server: typeof data.server === 'string' && data.server
        ? data.server
        : 'https://api.kaizenreport.com',
    };
  } catch {
    return null;
  }
}

/**
 * Persist auth to disk with restrictive permissions (0600). Creates parent
 * directories as needed.
 *
 * @param {{ workspace: string, token: string, server: string }} auth
 */
export function saveAuth(auth) {
  if (!auth || typeof auth !== 'object') throw new TypeError('auth must be an object');
  if (!auth.token) throw new TypeError('auth.token is required');
  const p = authPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({
    workspace: auth.workspace || '',
    token: auth.token,
    server: auth.server || 'https://api.kaizenreport.com',
  }, null, 2));
  // Best-effort chmod; a no-op on Windows.
  try { chmodSync(p, 0o600); } catch { /* ignore */ }
  return p;
}

/** Remove the persisted auth file (used by `kensho logout`, future). */
export function clearAuth() {
  const p = authPath();
  if (existsSync(p)) rmSync(p, { force: true });
}
