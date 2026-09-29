/**
 * ═══════════════════════════════════════════════════════════════════════
 *  BRAND — this fork ships as "TokenHarbor". One file, every brand URL.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * This app (the router) is free and open source. "Premium" is the PAID
 * catalog-update feed served by this fork's own catalog service (the
 * catalog/ workspace), currently deployed at tokenharbor.onrender.com.
 *
 *   BRAND_CATALOG_BASE_URL  — where this router pulls the signed catalog and
 *                             validates license keys.
 *   BRAND_PREMIUM_SITE_URL  — where "Go Premium" / key-recovery links in the
 *                             UI send users (the storefront, same service at /).
 *
 * Both remain overridable per deployment (CATALOG_BASE_URL /
 * PREMIUM_SITE_URL); self-hosters pointing at their own catalog service
 * should keep env overrides, not edits, here.
 */
export const BRAND_CATALOG_BASE_URL = 'https://tokenharbor.onrender.com';
export const BRAND_PREMIUM_SITE_URL = 'https://tokenharbor.onrender.com';
