import { fileURLToPath } from 'url';
import path from 'path';
import { loadEnv } from './env.js';
import { openDb, ensureStripeEventsTable } from './db.js';
import { CatalogStore } from './catalog-files.js';
import { LogMailer, ResendMailer } from './mailer.js';
import { stripeEnabledClient } from './stripe-client.js';
import { buildApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ (tsx dev) and dist/ (built) both sit one level under the package root.
process.chdir(path.resolve(__dirname, '..'));

await import('dotenv/config');

const env = loadEnv();
const db = openDb(env.dataDir);
ensureStripeEventsTable(db);
const store = new CatalogStore(env.dataDir);

const mailer = env.email.resendApiKey ? new ResendMailer(env.email.resendApiKey, env.email.from) : new LogMailer();
const stripe =
  env.stripeEnabled && env.stripe.secretKey && env.stripe.webhookSecret
    ? stripeEnabledClient(env.stripe.secretKey, env.stripe.webhookSecret)
    : null;

if (!stripe) {
  console.warn('[boot] Stripe not fully configured — catalog feed and manual keys work, checkout/portal/webhooks answer 503.');
}
if (!env.email.resendApiKey) {
  console.warn('[boot] RESEND_API_KEY unset — license emails are logged to stdout instead of sent.');
}

const app = buildApp({ env, db, store, mailer, stripe });
const server = app.listen(env.port, () => {
  console.log(`[boot] ${env.brand.name} catalog service on :${env.port} (data: ${env.dataDir})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[shutdown] ${signal}`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
