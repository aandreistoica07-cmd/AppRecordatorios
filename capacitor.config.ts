import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rutinas.recordatorios',
  appName: 'Rutinas',
  webDir: 'dist',
  backgroundColor: '#1e1f23',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor'
  },
  plugins: {
    LocalNotifications: {
      sound: 'default.wav'
    }
  }
};

export default config;
