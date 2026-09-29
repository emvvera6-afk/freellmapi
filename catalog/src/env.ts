import path from 'path';

/**
 * Central environment parsing. Anything brand- or billing-related funnels
 * through here so a rebrand/redeploy is an env change, not a code change.
 */

export interface BrandConfig {
  name: string;
  domain: string;
  siteUrl: string; // public-facing site (this service serves the landing at /)
  githubUrl: string;
  supportEmail: string;
}

export interface StripeConfig {
  secretKey: string | null;
  webhookSecret: string | null;
  priceAnnual: string | null;
  priceLifetime: string | null;
}

export interface EmailConfig {
  /** sendgrid | resend | null (auto from whichever key is set; else log) */
  provider: string | null;
  resendApiKey: string | null;
  sendgridApiKey: string | null;
  from: string;
}

/** Manual-payment rails shown on /buy and in order emails (all optional). */
export interface PaymentConfig {
  usdtAddress: string | null; // TRC20 implied in the copy
  paypalUrl: string | null; // e.g. https://paypal.me/you
  note: string | null; // free extra line ("also accept Zinli…")
}

export interface BackupConfig {
  githubRepo: string | null; // owner/repo (PRIVATE) holding the db backup
  githubToken: string | null; // fine-grained PAT, contents:write on that repo
  githubPath: string; // file path inside the repo
  githubBranch: string;
}

export interface AppEnv {
  port: number;
  dataDir: string;
  brand: BrandConfig;
  stripe: StripeConfig;
  email: EmailConfig;
  payment: PaymentConfig;
  backup: BackupConfig;
  /** Bearer token for /v1/admin/* (manual order fulfillment). Required in
   *  manual checkout mode. */
  adminToken: string | null;
  licenseKeyPrefix: string;
  priceAnnualUsd: string;
  priceLifetimeUsd: string;
  /** True when Stripe is fully configured; false boots a degraded service. */
  stripeEnabled: boolean;
  /** 'stripe' = checkout buttons hit Stripe; 'manual' = /buy order form.
   *  Auto: stripe when configured, manual otherwise. */
  checkoutMode: 'stripe' | 'manual';
}

function str(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function loadEnv(overrides: Partial<Record<string, string>> = {}): AppEnv {
  const get = (name: string): string | null =>
    overrides[name] !== undefined ? overrides[name] || null : str(name);

  const siteUrl = (get('SITE_URL') ?? 'http://localhost:8780').replace(/\/$/, '');
  const secretKey = get('STRIPE_SECRET_KEY');
  const webhookSecret = get('STRIPE_WEBHOOK_SECRET');
  const stripeEnabled = Boolean(secretKey && webhookSecret);
  const modeOverride = get('CHECKOUT_MODE');

  return {
    port: Number(process.env.PORT ?? 8780),
    dataDir: path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data')),
    brand: {
      name: get('BRAND_NAME') ?? 'Catalog',
      domain: get('BRAND_DOMAIN') ?? new URL(siteUrl).hostname,
      siteUrl,
      githubUrl: get('GITHUB_URL') ?? '#',
      supportEmail: get('SUPPORT_EMAIL') ?? 'support@example.com',
    },
    stripe: {
      secretKey,
      webhookSecret,
      priceAnnual: get('STRIPE_PRICE_ANNUAL'),
      priceLifetime: get('STRIPE_PRICE_LIFETIME'),
    },
    email: {
      provider: get('EMAIL_PROVIDER'),
      resendApiKey: get('RESEND_API_KEY'),
      sendgridApiKey: get('SENDGRID_API_KEY'),
      from: get('EMAIL_FROM') ?? 'Licenses <licenses@example.com>',
    },
    payment: {
      usdtAddress: get('PAY_USDT_ADDRESS'),
      paypalUrl: get('PAY_PAYPAL_URL'),
      note: get('PAY_NOTE'),
    },
    backup: {
      githubRepo: get('BACKUP_GITHUB_REPO'),
      githubToken: get('BACKUP_GITHUB_TOKEN'),
      githubPath: get('BACKUP_GITHUB_PATH') ?? 'backups/licenses.db',
      githubBranch: get('BACKUP_GITHUB_BRANCH') ?? 'main',
    },
    adminToken: get('ADMIN_TOKEN'),
    licenseKeyPrefix: (get('LICENSE_KEY_PREFIX') ?? 'PRO').toUpperCase(),
    priceAnnualUsd: get('PRICE_ANNUAL_USD') ?? '19',
    priceLifetimeUsd: get('PRICE_LIFETIME_USD') ?? '79',
    stripeEnabled,
    checkoutMode: modeOverride === 'manual' ? 'manual' : modeOverride === 'stripe' ? 'stripe' : stripeEnabled ? 'stripe' : 'manual',
  };
}
