import fs from 'fs';
import path from 'path';

/**
 * Serves the signed catalog products from disk. The signature lives in a
 * sidecar (`catalog.live.json.sig`, base64) produced at publish time by
 * `npm run sign`, so it always covers the exact bytes we ship.
 *
 * Reads are cached by mtime — a republish (new file) invalidates instantly
 * without a restart.
 */

export type Tier = 'live' | 'monthly';

export interface CatalogArtifact {
  bytes: Buffer;
  signature: string; // base64 Ed25519 over bytes
  version: string; // parsed from the JSON body (YYYY.MM.DD)
}

export class CatalogStore {
  private cache = new Map<Tier, { mtimeMs: number; artifact: CatalogArtifact | null }>();

  constructor(private dataDir: string) {}

  private load(tier: Tier): CatalogArtifact | null {
    const jsonPath = path.join(this.dataDir, `catalog.${tier}.json`);
    const sigPath = `${jsonPath}.sig`;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(jsonPath);
    } catch {
      return null; // product not published yet
    }
    const cached = this.cache.get(tier);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.artifact;

    let artifact: CatalogArtifact | null = null;
    try {
      const bytes = fs.readFileSync(jsonPath);
      const signature = fs.readFileSync(sigPath, 'utf8').trim();
      const version = (JSON.parse(bytes.toString('utf8')) as { version?: string }).version;
      if (signature && version) artifact = { bytes, signature, version };
    } catch {
      artifact = null; // unsigned or unparsable — refuse to serve
    }
    this.cache.set(tier, { mtimeMs: stat.mtimeMs, artifact });
    return artifact;
  }

  get(tier: Tier): CatalogArtifact | null {
    return this.load(tier);
  }
}
