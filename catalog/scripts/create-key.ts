/**
 * create-key — mint a license by hand (gifts, support, testing, sales made
 * outside Stripe). Stripe-managed keys are created by the webhook instead.
 *
 *   npm run create-key -- --email you@example.com --plan annual [--days 365]
 *   npm run create-key -- --email you@example.com --plan lifetime
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from '../src/env.js';
import { openDb } from '../src/db.js';
import { issueLicense } from '../src/keys.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, '..'));
await import('dotenv/config');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const email = arg('email');
const plan = (arg('plan') ?? 'annual') as 'annual' | 'lifetime';
if (!email || !email.includes('@') || (plan !== 'annual' && plan !== 'lifetime')) {
  console.error('Usage: npm run create-key -- --email <email> --plan annual|lifetime [--days N]');
  process.exit(1);
}

const env = loadEnv();
const db = openDb(env.dataDir);
const days = Number(arg('days') ?? 365);
const periodEnd = plan === 'annual' ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

const { key } = issueLicense(db, { email, plan, prefix: env.licenseKeyPrefix, periodEnd });

console.log('\nLicense issued (store it — only the hash is kept):\n');
console.log(`  ${key}`);
console.log(`\n  email:  ${email}`);
console.log(`  plan:   ${plan}${periodEnd ? ` (until ${periodEnd.toISOString().slice(0, 10)})` : ''}`);
console.log('\nDeliver it by email, then the buyer pastes it in the app: Settings → Premium.\n');
