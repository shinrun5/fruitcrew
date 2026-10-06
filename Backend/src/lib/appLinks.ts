// Universal Links (iOS) / App Links (Android): the two files each OS fetches
// from https://fruitcrew.app/.well-known/ to confirm the phone app may open
// fruitcrew.app links itself — invite links, the links in emails — instead of
// the browser. Built from env rather than static files so they're filled in
// on the host once the store accounts exist, no code change:
//
//   APPLE_TEAM_ID        Apple Developer team ID (falls back to APNS_TEAM_ID)
//   ANDROID_CERT_SHA256  the app-signing cert fingerprint(s) from Play Console
//                        → App integrity, comma-separated "AB:CD:…" values
//
// Unset = that file 404s, which each OS just treats as "open in the browser".
// Keep the path list in step with the intent-filter in
// Frontend/android/app/src/main/AndroidManifest.xml.

import { Router } from 'express';

const BUNDLE_ID = 'com.fruitcrew.app';

/** In-app screens a link may open (prefixes). The landing pages, legal pages
 * and admin console stay in the browser. */
export const APP_LINK_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password', // the emailed "choose a new password" link
  '/register', // also /register-manager and /register-store: invite links
  '/home',
  '/schedule',
  '/team',
  '/requests',
  '/settings',
  '/payroll',
  '/account',
  '/help',
  '/my-shifts',
  '/availability',
  '/marketplace',
  '/chat',
  '/notes',
  '/closing',
  '/more',
  '/profile',
];

const router = Router();

router.get('/.well-known/apple-app-site-association', (_req, res) => {
  const team = process.env.APPLE_TEAM_ID || process.env.APNS_TEAM_ID;
  if (!team) return res.sendStatus(404);
  res.type('application/json').send(
    JSON.stringify({
      applinks: {
        details: [
          {
            appIDs: [`${team}.${BUNDLE_ID}`],
            // a prefix match, same as Android's pathPrefix
            components: APP_LINK_PATHS.map((p) => ({ '/': `${p}*` })),
          },
        ],
      },
    }),
  );
});

router.get('/.well-known/assetlinks.json', (_req, res) => {
  const certs = (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (certs.length === 0) return res.sendStatus(404);
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: BUNDLE_ID, sha256_cert_fingerprints: certs },
    },
  ]);
});

export default router;
