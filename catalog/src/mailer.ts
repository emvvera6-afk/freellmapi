/**
 * Transactional email. Resend (https://resend.com) over HTTPS — no SMTP
 * library, one POST. Without an API key we log instead of send, so local
 * development and tests never stall on mail.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(msg: MailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API error ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

export class LogMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
    console.log(`[mailer] (not configured — logging) To: ${msg.to} | ${msg.subject}\n${msg.text}`);
  }
}

/** `Name <a@b.c>` → `a@b.c` — some providers want the bare address. */
function bareEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/**
 * SendGrid — free tier is 100 emails/day and, crucially for a $0 launch,
 * its "single sender verification" works with a plain Gmail address (no own
 * domain needed): verify once by clicking a link and you can send.
 * https://app.sendgrid.com/settings/sender_auth
 */
export class SendGridMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(msg: MailMessage): Promise<void> {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: bareEmail(this.from) },
        subject: msg.subject,
        content: [{ type: 'text/plain', value: msg.text }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SendGrid API error ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}

/**
 * Provider pick: explicit EMAIL_PROVIDER wins; otherwise whichever API key is
 * set (SendGrid preferred — it's the free, domain-less path); else log-only.
 */
export function createMailer(env: {
  email: { provider: string | null; resendApiKey: string | null; sendgridApiKey: string | null; from: string };
}): Mailer {
  const { provider, resendApiKey, sendgridApiKey, from } = env.email;
  if ((provider === 'sendgrid' || (!provider && sendgridApiKey)) && sendgridApiKey) {
    return new SendGridMailer(sendgridApiKey, from);
  }
  if ((provider === 'resend' || (!provider && resendApiKey)) && resendApiKey) {
    return new ResendMailer(resendApiKey, from);
  }
  return new LogMailer();
}

export function licenseEmail(brandName: string, key: string, supportEmail: string): { subject: string; text: string } {
  return {
    subject: `Your ${brandName} license key`,
    text: [
      `Thanks for supporting ${brandName}!`,
      '',
      'Your license key:',
      '',
      `    ${key}`,
      '',
      'Activate it in the app: Settings → Premium → paste the key. The live',
      'catalog feed switches on within seconds.',
      '',
      'Keep this email — the key is your only proof of purchase. If you lose',
      'it, use the key-recovery page on our site and we will rotate you a new one.',
      '',
      `Questions: ${supportEmail}`,
    ].join('\n'),
  };
}
