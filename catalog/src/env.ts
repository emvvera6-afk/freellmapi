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
  resendApiKey: string | null;
  from: string;
}

export interface AppEnv {
  port: number;
  dataDir: string;
  brand: BrandConfig;
  stripe: StripeConfig;
  email: EmailConfig;
  licenseKeyPrefix: string;
  priceAnnualUsd: string;
  priceLifetimeUsd: string;
  /** True when Stripe is fully configured; false boots a degraded service. */
  stripeEnabled: boolean;
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
      resendApiKey: get('RESEND_API_KEY'),
      from: get('EMAIL_FROM') ?? 'Licenses <licenses@example.com>',
    },
    licenseKeyPrefix: (get('LICENSE_KEY_PREFIX') ?? 'PRO').toUpperCase(),
    priceAnnualUsd: get('PRICE_ANNUAL_USD') ?? '19',
    priceLifetimeUsd: get('PRICE_LIFETIME_USD') ?? '79',
    stripeEnabled: Boolean(secretKey && webhookSecret),
  };
}
