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
