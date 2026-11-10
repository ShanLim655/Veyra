import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'chat.veyra.mobile',
  appName: 'Veyra',
  webDir: 'dist',
  server: {
    // The APK is a native shell around the deployed Veyra web app and API.
    url: 'https://veyra-pink-mu.vercel.app',
    cleartext: false,
  },
};

export default config;
