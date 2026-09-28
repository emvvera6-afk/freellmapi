import crypto from 'crypto';

/**
 * Ed25519 catalog signing. The router app pins the PUBLIC key and verifies
 * `x-catalog-signature` over the exact response bytes — the private key is
 * only ever loaded by the signing/publish scripts, never by the HTTP server.
 */

export function privateKeyFromPem(pem: string): crypto.KeyObject {
  return crypto.createPrivateKey({ key: pem.replace(/\\n/g, '\n'), format: 'pem' });
}

export function publicKeyFromPem(pem: string): crypto.KeyObject {
  return crypto.createPublicKey({ key: pem.replace(/\\n/g, '\n'), format: 'pem' });
}

export function signBytes(priv: crypto.KeyObject, bytes: Buffer): string {
  return crypto.sign(null, bytes, priv).toString('base64');
}

export function verifyBytes(pub: crypto.KeyObject, bytes: Buffer, signatureB64: string): boolean {
  return crypto.verify(null, bytes, pub, Buffer.from(signatureB64, 'base64'));
}

export function generateKeyPairPem(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
