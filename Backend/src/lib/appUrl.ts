/** The web app's public origin, no trailing slash — '' when APP_URL isn't
 * set, and then emails and notifications leave their links out. */
export const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

/** For links that must always be absolute (calendar feeds, password resets):
 * the production site when APP_URL isn't set. */
export const PUBLIC_URL = APP_URL || 'https://fruitcrew.app';
