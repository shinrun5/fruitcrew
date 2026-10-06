// Sign in with Apple, server side: Apple's REST API for the one thing Supabase
// doesn't do for us — revoking a person's Sign in with Apple when they delete
// their account, which App Review requires of any app that offers it.
//
// At sign-in the app hands over Apple's one-time authorization code; we trade
// it for a refresh token (stored on the User) and revoke that on deletion.
// Both calls authenticate with a short-lived "client secret": a JWT signed by
// a Sign in with Apple key. Defaults to the APNs key's settings, since one key
// can do both (developer.apple.com → Keys, with both services ticked):
//
//   APPLE_SIGNIN_KEY     the .p8 contents (raw or base64)   — else APNS_KEY
//   APPLE_SIGNIN_KEY_ID  that key's Key ID                   — else APNS_KEY_ID
//   APPLE_TEAM_ID        the team ID                         — else APNS_TEAM_ID

import { sign as cryptoSign } from 'node:crypto';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const rawOrBase64 = (v: string) => (v.trim().startsWith('-----') ? v : Buffer.from(v, 'base64').toString('utf8'));

function config() {
  const key = process.env.APPLE_SIGNIN_KEY || process.env.APNS_KEY;
  const keyId = process.env.APPLE_SIGNIN_KEY_ID || process.env.APNS_KEY_ID;
  const teamId = process.env.APPLE_TEAM_ID || process.env.APNS_TEAM_ID;
  if (!key || !keyId || !teamId) return null;
  return { key: rawOrBase64(key).replace(/\\n/g, '\n'), keyId, teamId };
}

/** `clientId` is whoever the sign-in was for: the app's bundle ID for the
 * iPhone app, the Services ID for the website (it's the identity token's `aud`). */
function clientSecret(cfg: NonNullable<ReturnType<typeof config>>, clientId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: clientId }));
  const sig = cryptoSign('sha256', Buffer.from(`${head}.${claims}`), { key: cfg.key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(sig)}`;
}

async function post(path: 'token' | 'revoke', form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`https://appleid.apple.com/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

/** The `aud` (client ID) of an identity token Supabase has already verified. */
export function audienceOf(idToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aud?: unknown };
    return typeof payload.aud === 'string' ? payload.aud : null;
  } catch {
    return null;
  }
}

/** Trade the one-time authorization code (valid ~5 min, single use) for a refresh token. */
export async function exchangeAppleCode(code: string, clientId: string): Promise<string> {
  const cfg = config();
  if (!cfg) throw new Error('Sign in with Apple key not configured (APPLE_SIGNIN_KEY / APNS_KEY)');
  const r = await post('token', {
    client_id: clientId,
    client_secret: clientSecret(cfg, clientId),
    code,
    grant_type: 'authorization_code',
  });
  const token = r.body.refresh_token;
  if (r.status !== 200 || typeof token !== 'string') throw new Error(`Apple token ${r.status}: ${JSON.stringify(r.body)}`);
  return token;
}

/** Tell Apple to end this app's Sign in with Apple for the person. */
export async function revokeAppleToken(refreshToken: string, clientId: string): Promise<void> {
  const cfg = config();
  if (!cfg) throw new Error('Sign in with Apple key not configured (APPLE_SIGNIN_KEY / APNS_KEY)');
  const r = await post('revoke', {
    client_id: clientId,
    client_secret: clientSecret(cfg, clientId),
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });
  if (r.status !== 200) throw new Error(`Apple revoke ${r.status}: ${JSON.stringify(r.body)}`);
}
