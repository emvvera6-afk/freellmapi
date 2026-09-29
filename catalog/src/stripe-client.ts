import Stripe from 'stripe';

/**
 * Narrow seam over the Stripe SDK: exactly the operations the service needs,
 * expressed in plain types, so tests inject a fake without fighting SDK
 * generics — and a future provider swap (Paddle, Lemon Squeezy) touches one
 * file.
 */

export interface CheckoutSessionResult {
  id: string;
  url: string | null;
}

export interface PortalSessionResult {
  url: string;
}

/** The sliver of a webhook event fulfillment needs (SDK-version-proof). */
export interface WebhookEvent {
  id: string;
  type: string;
  /** Raw event object: checkout session, subscription, invoice, charge… */
  data: Record<string, unknown>;
}

export interface StripeLike {
  createCheckoutSession(args: {
    priceId: string;
    mode: 'subscription' | 'payment';
    plan: 'annual' | 'lifetime';
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSessionResult>;

  /** What the success page polls. `keyFetched` = true when we already know
   *  this session maps to an issued license. */
  retrieveCheckoutEmail(id: string): Promise<string | null>;

  createPortalSession(customerId: string, returnUrl: string): Promise<PortalSessionResult>;

  /** Verifies the signature header and returns the typed event. Throws on
   *  bad signature. */
  constructWebhookEvent(rawBody: Buffer, signatureHeader: string): WebhookEvent;
}

export function stripeEnabledClient(secretKey: string, webhookSecret: string): StripeLike {
  const stripe = new Stripe(secretKey);

  return {
    async createCheckoutSession(args) {
      const session = await stripe.checkout.sessions.create({
        mode: args.mode,
        line_items: [{ price: args.priceId, quantity: 1 }],
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
        allow_promotion_codes: true,
        metadata: { plan: args.plan },
        ...(args.mode === 'subscription'
          ? { subscription_data: { metadata: { plan: args.plan } } }
          : { payment_intent_data: { metadata: { plan: args.plan } } }),
      });
      return { id: session.id, url: session.url };
    },

    async retrieveCheckoutEmail(id) {
      const session = await stripe.checkout.sessions.retrieve(id);
      return session.customer_details?.email ?? session.customer_email ?? null;
    },

    async createPortalSession(customerId, returnUrl) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },

    constructWebhookEvent(rawBody, signatureHeader) {
      const event = stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
      return {
        id: event.id,
        type: event.type,
        data: event.data.object as unknown as Record<string, unknown>,
      };
    },
  };
}

/** Extract the current period end (unix seconds) from a subscription object,
 *  tolerating the field's migration to item level in newer API versions. */
export function subscriptionPeriodEndUnix(sub: Record<string, unknown>): number | null {
  if (typeof sub.current_period_end === 'number') return sub.current_period_end;
  const items = sub.items as { data?: { current_period_end?: number }[] } | undefined;
  const fromItem = items?.data?.[0]?.current_period_end;
  return typeof fromItem === 'number' ? fromItem : null;
}

export function unixToIso(unix: number | null): string | null {
  return unix ? new Date(unix * 1000).toISOString() : null;
}
