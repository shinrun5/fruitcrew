// The bits of hand-rolled JWT signing shared by push.ts (APNs, FCM) and
// appleSignIn.ts — no SDKs for either, so no JWT library either.

import { sign as cryptoSign } from 'node:crypto';

export const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

// env values may be pasted raw (multi-line PEM / JSON) or base64'd to dodge
// hosting dashboards that mangle newlines
export const rawOrBase64 = (v: string) =>
  v.trim().startsWith('-----') || v.trim().startsWith('{') ? v : Buffer.from(v, 'base64').toString('utf8');

/** A PEM key from an env value, raw or base64'd, with any literal "\n"s turned back into newlines. */
export const pemFromEnv = (v: string) => rawOrBase64(v).replace(/\\n/g, '\n');

/** A JWT signed with an Apple .p8 key (ES256) — APNs auth tokens and Sign in with Apple client secrets. */
export function appleKeyJwt(key: string, keyId: string, claims: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const body = b64url(JSON.stringify(claims));
  const sig = cryptoSign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64url(sig)}`;
}
