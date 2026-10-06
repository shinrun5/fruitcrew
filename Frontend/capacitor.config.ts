import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fruitcrew.app',
  appName: 'Fruit Crew',
  webDir: 'dist',
  ios: {
    // the cream behind the app while it loads — not the web view's default
    // white, which flashes between the launch screen and the first paint
    backgroundColor: '#fff8ec',
  },
  plugins: {
    // Keeps the launch picture (cream + logo, the "Splash" image) up until the
    // app has worked out who's signed in — see lib/auth.tsx — instead of iOS
    // dropping it the instant the app process starts, a beat before the page
    // can draw. Hides itself after 4s regardless, so it can never get stuck.
    SplashScreen: {
      launchShowDuration: 4000,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: '#fff8ec',
      showSpinner: false,
    },
    PushNotifications: {
      // show the banner + sound even while the app is open (iOS hides them by default)
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
