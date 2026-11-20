import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.jeeveshpatil.shadowhunt',
  appName: 'ShadowHunt Pro',
  webDir: 'dist',
  backgroundColor: '#05080a',
  android: {
    // keeps background location updates flowing past Android's 5-minute WebView limit
    // (capacitor-community/background-geolocation#89)
    useLegacyBridge: true,
  },
  ios: { contentInset: 'never' },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: '#05080a', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#05080a', overlaysWebView: false },
    LocalNotifications: { smallIcon: 'ic_stat_shadowhunt', iconColor: '#2dffa0' },
  },
};

export default config;
