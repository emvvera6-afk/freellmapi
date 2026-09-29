import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Db, LicenseRow } from '../db.js';
import { getLicenseByHash } from '../db.js';
import { evaluate, hashKey } from '../keys.js';

/**
 * License lifecycle endpoints the router app calls (see
 * server/src/routes/premium.ts):
 *   POST /v1/license/activate  { key }            → payload
 *   GET  /v1/license/check     Authorization: Bearer <key>
 *
 * Both answer 200 even for bad keys; invalidity rides in the JSON body
 * (`reason`), keeping the app's sync loop error-free.
 */
export function licenseRouter(deps: { db: Db }): Router {
  const r = Router();

  const lookup = (rawKey: unknown): LicenseRow | null => {
    if (typeof rawKey !== 'string' || rawKey.trim().length < 8) return null;
    return getLicenseByHash(deps.db, hashKey(rawKey));
  };

  r.post('/license/activate', (req: Request, res: Response) => {
    res.json(evaluate(lookup(req.body?.key)));
  });

  r.get('/license/check', (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    const key = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    res.json(evaluate(lookup(key)));
  });

  return r;
}
