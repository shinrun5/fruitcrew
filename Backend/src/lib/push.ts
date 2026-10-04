// Push notifications to the phone apps: APNs (Apple) for iOS, FCM (Firebase)
// for Android. No SDKs — APNs is one HTTP/2 POST with a signed JWT, FCM is one
// HTTPS POST with an OAuth token minted from a service account. Like email.ts,
// a platform with no credentials set is logged and skipped, so dev and the web
// app don't need any of this.
//
// iOS    APNS_KEY       the .p8 auth key's contents (raw PEM, or base64 of it)
//        APNS_KEY_ID    that key's 10-character Key ID
//        APNS_TEAM_ID   the Apple Developer team ID
//        APNS_BUNDLE_ID optional, defaults to com.fruitcrew.app
// Android FCM_SERVICE_ACCOUNT  the Firebase service-account JSON (raw, or base64 of it)

import { connect } from 'node:http2';
import { createSign, sign as cryptoSign } from 'node:crypto';
import prisma from './prisma.js';
import { alertError } from './errorAlert.js';

export interface PushMessage {
  title: string;
  body?: string | undefined;
  /** client-side path the app opens when the notification is tapped */
  link?: string | undefined;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
// env values may be pasted raw (multi-line PEM / JSON) or base64'd to dodge
// hosting dashboards that mangle newlines
const rawOrBase64 = (v: string) => (v.trim().startsWith('-----') || v.trim().startsWith('{') ? v : Buffer.from(v, 'base64').toString('utf8'));

// ---- APNs ------------------------------------------------------------------

let apnsJwt: { token: string; at: number } | null = null;

function apnsConfig() {
  const key = process.env.APNS_KEY;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!key || !keyId || !teamId) return null;
  return { key: rawOrBase64(key).replace(/\\n/g, '\n'), keyId, teamId, topic: process.env.APNS_BUNDLE_ID || 'com.fruitcrew.app' };
}

/** Apple wants a fresh-ish token: reuse one for up to 50 min (they reject > 60). */
function apnsToken(cfg: NonNullable<ReturnType<typeof apnsConfig>>): string {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwt && now - apnsJwt.at < 50 * 60) return apnsJwt.token;
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: now }));
  const sig = cryptoSign('sha256', Buffer.from(`${head}.${claims}`), { key: cfg.key, dsaEncoding: 'ieee-p1363' });
  apnsJwt = { token: `${head}.${claims}.${b64url(sig)}`, at: now };
  return apnsJwt.token;
}

function apnsPost(host: string, deviceToken: string, jwt: string, topic: string, payload: string): Promise<{ status: number; reason: string | undefined }> {
  return new Promise((resolve, reject) => {
    const client = connect(host);
    client.on('error', reject);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    req.on('response', (h) => (status = Number(h[':status'])));
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      client.close();
      let reason: string | undefined;
      try {
        reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
      } catch {
        reason = body;
      }
      resolve({ status, reason });
    });
    req.on('error', (e) => {
      client.close();
      reject(e);
    });
    req.end(payload);
  });
}

/** 'ok' | 'gone' (token is dead — drop it) | 'skip' (not configured) */
async function sendApns(deviceToken: string, m: PushMessage): Promise<'ok' | 'gone' | 'skip'> {
  const cfg = apnsConfig();
  if (!cfg) return 'skip';
  const payload = JSON.stringify({
    aps: { alert: { title: m.title, ...(m.body ? { body: m.body } : {}) }, sound: 'default' },
    ...(m.link ? { link: m.link } : {}),
  });
  const jwt = apnsToken(cfg);
  let r = await apnsPost('https://api.push.apple.com', deviceToken, jwt, cfg.topic, payload);
  // a build run straight from Xcode registers with the sandbox, not production
  if (r.status === 400 && r.reason === 'BadDeviceToken') {
    r = await apnsPost('https://api.sandbox.push.apple.com', deviceToken, jwt, cfg.topic, payload);
  }
  if (r.status === 200) return 'ok';
  if (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered') return 'gone';
  throw new Error(`APNs ${r.status} ${r.reason ?? ''}`);
}

// ---- FCM -------------------------------------------------------------------

let fcmAccess: { token: string; exp: number } | null = null;

function fcmConfig() {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  const sa = JSON.parse(rawOrBase64(raw)) as { project_id: string; client_email: string; private_key: string };
  return sa;
}

async function fcmToken(sa: NonNullable<ReturnType<typeof fcmConfig>>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmAccess && fcmAccess.exp - 60 > now) return fcmAccess.token;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${claims}`);
  const assertion = `${head}.${claims}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`FCM auth ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  fcmAccess = { token: data.access_token, exp: now + data.expires_in };
  return fcmAccess.token;
}

async function sendFcm(deviceToken: string, m: PushMessage): Promise<'ok' | 'gone' | 'skip'> {
  const sa = fcmConfig();
  if (!sa) return 'skip';
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await fcmToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: m.title, ...(m.body ? { body: m.body } : {}) },
        ...(m.link ? { data: { link: m.link } } : {}),
        // "default" is the channel the app creates on first launch (see Frontend/src/lib/push.ts)
        android: { priority: 'high', notification: { channel_id: 'default' } },
      },
    }),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('registration token is not a valid')) return 'gone';
  throw new Error(`FCM ${res.status}: ${text}`);
}

// ---- public ----------------------------------------------------------------

/** Send to every phone this user is signed in on. Never throws — a push is a
 * nice-to-have on top of the in-app notification, not something to fail on. */
export async function pushToUser(userId: number, m: PushMessage): Promise<void> {
  const devices = await prisma.deviceToken.findMany({ where: { userId } });
  for (const d of devices) {
    try {
      const r = d.platform === 'ios' ? await sendApns(d.token, m) : await sendFcm(d.token, m);
      if (r === 'gone') await prisma.deviceToken.deleteMany({ where: { id: d.id } });
      if (r === 'skip') console.log(`[push] (${d.platform} not configured) would send "${m.title}" -> user ${userId}`);
    } catch (e) {
      alertError('push.send', e as Error, { userId, platform: d.platform });
    }
  }
}
