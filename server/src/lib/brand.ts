/**
 * ═══════════════════════════════════════════════════════════════════════
 *  FORK REBRAND POINT — read this before shipping.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This app (the router) is free and open source. "Premium" is the PAID
 * catalog-update feed, and the upstream defaults pointed at the original
 * author's service (freellmapi.co). This fork runs its OWN catalog service
 * (see the catalog/ workspace at the repo root).
 *
 * Two URLs matter:
 *
 *   BRAND_CATALOG_BASE_URL  — where this router pulls the signed catalog and
 *                             validates license keys (your catalog/ service).
 *   BRAND_PREMIUM_SITE_URL  — where "Go Premium" / key-recovery links in the
 *                             UI send users (your storefront, served by the
 *                             same catalog/ service at /).
 *
 * Set your domain HERE before building a release, or per-deployment via the
 * CATALOG_BASE_URL / PREMIUM_SITE_URL env vars. If you ship these example
 * placeholders, premium activation UI will point at a dead domain — that is
 * deliberate: silently paying the upstream author's Stripe would be worse.
 */
export const BRAND_CATALOG_BASE_URL = 'https://api.yourbrand.example';
export const BRAND_PREMIUM_SITE_URL = 'https://yourbrand.example';
