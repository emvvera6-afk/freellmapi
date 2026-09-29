/**
 * keygen — one-time Ed25519 keypair setup.
 *
 *   npm run keygen
 *
 * Writes the PRIVATE key to catalog/.env (gitignored — verified before
 * writing) as CATALOG_PRIVKEY, and prints the PUBLIC key for you to paste as
 * PINNED_CATALOG_PUBKEY in server/src/services/catalog-sync.ts — that's the
 * copy shipped inside every router install.
 *
 * The private key signs catalogs; losing it means re-keying the whole fleet
 * (new keypair + app release). Back it up in your password manager.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateKeyPairPem } from '../src/signing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PKG_ROOT, '.env');

function isIgnored(relPath: string, repoRoot: string): boolean {
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  return gitignore.split('\n').some((line) => {
    const pat = line.trim();
    return pat && !pat.startsWith('#') && (pat === relPath || pat === path.basename(relPath));
  });
}

function main() {
  const force = process.argv.includes('--force');
  if (fs.existsSync(ENV_PATH) && fs.readFileSync(ENV_PATH, 'utf8').includes('CATALOG_PRIVKEY=') && !force) {
    const existing = fs.readFileSync(ENV_PATH, 'utf8');
    if (/CATALOG_PRIVKEY=.+BEGIN/.test(existing)) {
      console.error('.env already contains CATALOG_PRIVKEY. Use --force to rotate (remember to re-pin the public key and re-sign both tiers).');
      process.exit(1);
    }
  }

  const repoRoot = path.resolve(PKG_ROOT, '..');
  if (!isIgnored('.env', repoRoot)) {
    console.error('SAFETY: .env is not covered by the repo .gitignore — refusing to write a private key.');
    process.exit(1);
  }

  const { publicKeyPem, privateKeyPem } = generateKeyPairPem();

  const escapedPriv = privateKeyPem.replace(/\n/g, '\\n');
  const envLine = `CATALOG_PRIVKEY="${escapedPriv}"\n`;
  const prior = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const next = /CATALOG_PRIVKEY=.*\n?/.test(prior)
    ? prior.replace(/CATALOG_PRIVKEY=.*\n?/, envLine)
    : prior + (prior.endsWith('\n') || prior === '' ? '' : '\n') + envLine;
  fs.writeFileSync(ENV_PATH, next, { mode: 0o600 });

  console.log('Keypair generated.');
  console.log(`Private key -> ${ENV_PATH} (gitignored, mode 0600). Back it up NOW.`);
  console.log('\nPublic key — pin this in server/src/services/catalog-sync.ts as PINNED_CATALOG_PUBKEY:\n');
  console.log(publicKeyPem);
}

main();
