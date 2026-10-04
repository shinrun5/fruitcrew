import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fruitcrew.app',
  appName: 'Fruit Crew',
  webDir: 'dist',
  plugins: {
    PushNotifications: {
      // show the banner + sound even while the app is open (iOS hides them by default)
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
