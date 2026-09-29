import { afterEach, describe, expect, it, vi } from 'vitest';
import { SendGridMailer, ResendMailer, createMailer } from '../mailer.js';

describe('SendGridMailer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the SendGrid v3 shape with a bare from-address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const mailer = new SendGridMailer('SG.test-key', 'Tienda <tienda@gmail.com>');
    await mailer.send({ to: 'buyer@x.com', subject: 'key', text: 'PRO-XXXX' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer SG.test-key');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      personalizations: [{ to: [{ email: 'buyer@x.com' }] }],
      from: { email: 'tienda@gmail.com' },
      subject: 'key',
      content: [{ type: 'text/plain', value: 'PRO-XXXX' }],
    });
  });

  it('throws on non-2xx so callers can log the failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 401 })));
    const mailer = new SendGridMailer('SG.bad', 'a@b.c');
    await expect(mailer.send({ to: 'x@y.z', subject: 's', text: 't' })).rejects.toThrow('SendGrid API error 401');
  });
});

describe('mailer factory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers sendgrid when its key is set, falls back to resend, then log', () => {
    expect(
      createMailer({ email: { provider: null, sendgridApiKey: 'SG.1', resendApiKey: 're_1', from: 'a@b.c' } }),
    ).toBeInstanceOf(SendGridMailer);
    expect(
      createMailer({ email: { provider: null, sendgridApiKey: null, resendApiKey: 're_1', from: 'a@b.c' } }),
    ).toBeInstanceOf(ResendMailer);
    const log = createMailer({ email: { provider: null, sendgridApiKey: null, resendApiKey: null, from: 'a@b.c' } });
    expect(log.constructor.name).toBe('LogMailer');
    expect(
      createMailer({ email: { provider: 'resend', sendgridApiKey: 'SG.1', resendApiKey: 're_1', from: 'a@b.c' } }),
    ).toBeInstanceOf(ResendMailer);
  });
});
