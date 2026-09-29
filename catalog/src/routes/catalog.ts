import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Db } from '../db.js';
import { getLicenseByHash } from '../db.js';
import { evaluate, hashKey } from '../keys.js';
import type { CatalogStore, Tier } from '../catalog-files.js';
import type { Mailer } from '../mailer.js';
import { rotateLicense } from '../keys.js';
import { getLicensesByEmail } from '../db.js';

/**
 * The ONE endpoint the router app polls twice a day:
 *
 *   GET /v1/latest?since=YYYY.MM.DD
 *     Authorization: Bearer <license key>   (optional — valid ⇒ live tier)
 *
 * Answers 304 when `since` matches the caller's tier version, else the exact
 * signed bytes with `x-catalog-signature` (Ed25519, base64) — verified by the
 * pinned public key in the app. An INVALID key silently falls back to the
 * monthly tier; it never errors the sync loop.
 */
export function catalogRouter(deps: {
  db: Db;
  store: CatalogStore;
  mailer: Mailer;
  keyPrefix: string;
  onStateChange?: () => void;
}): Router {
  const r = Router();

  r.get('/latest', (req: Request, res: Response) => {
    let tier: Tier = 'monthly';
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const row = getLicenseByHash(deps.db, hashKey(auth.slice(7)));
      if (evaluate(row).valid) tier = 'live';
    }

    const artifact = deps.store.get(tier);
    if (!artifact) {
      res.status(503).json({ error: `${tier} catalog not published yet. Run npm run sign in catalog/.` });
      return;
    }

    const since = typeof req.query.since === 'string' ? req.query.since : null;
    if (since && since === artifact.version) {
      res.status(304).end();
      return;
    }

    res
      .status(200)
      .set({
        'content-type': 'application/json; charset=utf-8',
        'x-catalog-signature': artifact.signature,
        'x-catalog-version': artifact.version,
        'x-catalog-tier': tier,
        'cache-control': 'no-store',
      })
      .send(artifact.bytes);
  });

  /**
   * POST /v1/key/recover { email } — key recovery via rotation. Always 200
   * (no account enumeration): if the email owns licenses, each gets rotated
   * and the replacement keys are mailed. Old keys die immediately.
   */
  r.post('/key/recover', async (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    if (email && email.includes('@')) {
      const rows = getLicensesByEmail(deps.db, email);
      const keys: string[] = [];
      for (const row of rows) {
        if (row.status !== 'active') continue;
        const rotated = rotateLicense(deps.db, row.key_hash, deps.keyPrefix);
        if (rotated) keys.push(rotated.key);
      }
      if (keys.length > 0) deps.onStateChange?.();
      if (keys.length > 0) {
        try {
          await deps.mailer.send({
            to: email,
            subject: 'Your replacement license key',
            text: [
              'A key recovery was requested for this email.',
              '',
              'Your previous key(s) have been deactivated. Your new key:',
              '',
              ...keys.map((k) => `    ${k}`),
              '',
              'Paste it in the app: Settings → Premium.',
            ].join('\n'),
          });
        } catch (err) {
          console.error('[recover] mail failed:', err instanceof Error ? err.message : err);
          // Fall through to the generic 200 — the rotation DID happen, and an
          // operator can resend from the logs if the mail provider hiccupped.
        }
      }
    }
    res.json({ ok: true });
  });

  return r;
}
