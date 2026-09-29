import fs from 'fs';
import path from 'path';
import type { BackupConfig } from './env.js';

/**
 * GitHub-backed database backup — the trick that makes a $0 host (free
 * Render/Fly with ephemeral disks) survivable: `licenses.db` is one small
 * SQLite file, so the service pushes it to a PRIVATE GitHub repo (debounced,
 * after every state-changing request) and restores it on boot when the local
 * file is gone (fresh deploy / ephemeral disk wipe).
 *
 * Uses the REST Contents API with a fine-grained PAT (contents:write on the
 * backup repo only). Failure modes are deliberately soft: a broken backup
 * must never take the revenue path down — errors log and the service keeps
 * serving (worst case you lose the mutations since the last good push).
 *
 * Set BACKUP_GITHUB_REPO + BACKUP_GITHUB_TOKEN to enable; otherwise inert.
 */
export class GithubBackup {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  readonly enabled: boolean;

  constructor(
    private cfg: BackupConfig,
    private localPath: string,
    private debounceMs = 15_000,
  ) {
    this.enabled = Boolean(cfg.githubRepo && cfg.githubToken);
  }

  private api(path: string): string {
    return `https://api.github.com/repos/${this.cfg.githubRepo}/contents/${path}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  /** Restore the db file on boot if it is missing locally. Best-effort. */
  async restore(): Promise<boolean> {
    if (!this.enabled || fs.existsSync(this.localPath)) return false;
    try {
      const res = await fetch(this.api(this.cfg.githubPath), {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        if (res.status !== 404) console.warn(`[backup] restore skipped: GitHub ${res.status}`);
        return false;
      }
      const body = (await res.json()) as { content?: string; size?: number };
      if (!body.content) return false;
      fs.mkdirSync(path.dirname(this.localPath), { recursive: true });
      fs.writeFileSync(this.localPath, Buffer.from(body.content, 'base64'), { mode: 0o600 });
      console.log(`[backup] restored ${body.size ?? '?'} bytes from ${this.cfg.githubRepo}/${this.cfg.githubPath}`);
      return true;
    } catch (err) {
      console.warn(`[backup] restore failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  /** Debounced save — call after any state-changing operation. */
  schedule(): void {
    if (!this.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.save().catch(() => {});
    }, this.debounceMs);
    this.timer.unref?.();
  }

  /** Flush any pending save (call before shutdown). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.save().catch(() => {});
    }
    if (this.inFlight) await this.inFlight.catch(() => {});
  }

  /** Push the current file. Retries next mutation on failure. */
  async save(): Promise<void> {
    if (!this.enabled || !fs.existsSync(this.localPath)) return;
    try {
      // Need the existing blob sha to update (404 ⇒ first upload, sha absent).
      let sha: string | undefined;
      const head = await fetch(this.api(this.cfg.githubPath), { headers: this.headers() });
      if (head.ok) sha = ((await head.json()) as { sha?: string }).sha;

      const content = fs.readFileSync(this.localPath).toString('base64');
      const res = await fetch(this.api(this.cfg.githubPath), {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({
          message: `backup: licenses.db ${new Date().toISOString()}`,
          content,
          ...(sha ? { sha } : {}),
          branch: this.cfg.githubBranch,
        }),
      });
      if (!res.ok) {
        console.warn(`[backup] push failed: GitHub ${res.status} ${(await res.text()).slice(0, 120)}`);
        return;
      }
      console.log('[backup] licenses.db pushed to GitHub');
    } catch (err) {
      console.warn(`[backup] push error: ${err instanceof Error ? err.message : err}`);
    }
  }
}
