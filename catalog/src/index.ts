import { fileURLToPath } from 'url';
import path from 'path';
import { loadEnv } from './env.js';
import { openDb, ensureStripeEventsTable, dbPath } from './db.js';
import { CatalogStore } from './catalog-files.js';
import { createMailer } from './mailer.js';
import { stripeEnabledClient } from './stripe-client.js';
import { GithubBackup } from './backup.js';
import { buildApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ (tsx dev) and dist/ (built) both sit one level under the package root.
process.chdir(path.resolve(__dirname, '..'));

await import('dotenv/config');

const env = loadEnv();
const backup = new GithubBackup(env.backup, dbPath(env.dataDir));
// Ephemeral-disk hosts: pull the last bootstrapped state before opening the DB.
await backup.restore();

const db = openDb(env.dataDir);
ensureStripeEventsTable(db);
const store = new CatalogStore(env.dataDir);

const mailer = createMailer(env);
const stripe =
  env.stripeEnabled && env.stripe.secretKey && env.stripe.webhookSecret
    ? stripeEnabledClient(env.stripe.secretKey, env.stripe.webhookSecret)
    : null;

if (env.checkoutMode === 'manual') {
  console.log('[boot] checkout mode: MANUAL — /buy order form is live; fulfill orders with ADMIN_TOKEN.');
  if (!env.adminToken) console.warn('[boot] ADMIN_TOKEN unset — order fulfillment endpoint will answer 503!');
  if (!env.payment.usdtAddress && !env.payment.paypalUrl) {
    console.warn('[boot] no PAY_USDT_ADDRESS / PAY_PAYPAL_URL — /buy will tell buyers payments are being set up.');
  }
}

const app = buildApp({ env, db, store, mailer, stripe, onStateChange: () => backup.schedule() });
const server = app.listen(env.port, () => {
  console.log(`[boot] ${env.brand.name} catalog service on :${env.port} (data: ${env.dataDir})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[shutdown] ${signal}`);
    void backup.flush().finally(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    });
  });
}
