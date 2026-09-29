/**
 * sign-catalog — sign the catalog products so routers will trust them.
 *
 *   npm run sign              # sign data/catalog.live.json + catalog.monthly.json
 *   npm run promote-monthly   # copy live → monthly (tier field rewritten), then sign both
 *
 * Input JSONs come from the router's exporter:
 *   npm run export-catalog -w server -- --tier live --out catalog/data/catalog.live.json
 *
 * The signature (data/*.sig, base64 Ed25519) covers the exact file bytes; the
 * HTTP server serves those bytes verbatim with x-catalog-signature.
 * CATALOG_PRIVKEY comes from catalog/.env (never committed).
 *
 * --bump-version stamps version=today (YYYY.MM.DD) before signing — use it
 * after hand-editing a catalog file.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { privateKeyFromPem, signBytes } from '../src/signing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, '..'));
await import('dotenv/config');

const PKG_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(PKG_ROOT, 'data'));

function arg(flag: string): boolean {
  return process.argv.includes(flag);
}

function dateVersion(d = new Date()): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

function readCatalog(tier: 'live' | 'monthly'): { path: string; doc: Record<string, unknown> } {
  const p = path.join(DATA_DIR, `catalog.${tier}.json`);
  if (!fs.existsSync(p)) {
    console.error(`Missing ${p}. Export it first (see header comment).`);
    process.exit(1);
  }
  return { path: p, doc: JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown> };
}

function writeCatalog(p: string, doc: Record<string, unknown>): void {
  // Same serialization convention as the router's exporter, so byte output is
  // stable across tools.
  fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
}

function main() {
  if (arg('--promote-monthly')) {
    const live = readCatalog('live');
    const monthlyDoc = { ...live.doc, tier: 'monthly' };
    const monthlyPath = path.join(DATA_DIR, 'catalog.monthly.json');
    writeCatalog(monthlyPath, monthlyDoc);
    console.log(`Promoted live v${String(live.doc.version)} → monthly snapshot.`);
  }

  const privPem = process.env.CATALOG_PRIVKEY;
  if (!privPem) {
    console.error('CATALOG_PRIVKEY is not set. Run `npm run keygen` first (it writes catalog/.env).');
    process.exit(1);
  }
  const priv = privateKeyFromPem(privPem);

  for (const tier of ['live', 'monthly'] as const) {
    const { path: p, doc } = readCatalog(tier);
    if (arg('--bump-version')) {
      doc.version = dateVersion();
      doc.generatedAt = new Date().toISOString();
      writeCatalog(p, doc);
      console.log(`Bumped ${tier} version → ${String(doc.version)}`);
    }
    if (doc.tier !== tier) {
      console.error(`${p}: "tier" field is ${JSON.stringify(doc.tier)} — expected ${JSON.stringify(tier)}. Fix before signing.`);
      process.exit(1);
    }
    const bytes = fs.readFileSync(p);
    const sig = signBytes(priv, bytes);
    fs.writeFileSync(`${p}.sig`, sig + '\n');
    console.log(`Signed ${tier} v${String(doc.version)} (${bytes.length} bytes) → ${p}.sig`);
  }
}

main();
