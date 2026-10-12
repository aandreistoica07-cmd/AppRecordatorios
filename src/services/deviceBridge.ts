// @section: Native-Haptics-And-StatusBar-Bridge

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Configura la barra de estado de iOS con texto/iconos claros sobre fondo oscuro (#1e1f23).
 * En navegador web no lanza ningún error.
 */
export async function configureNativeStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    // Ignorar en entornos sin soporte de StatusBar
  }
}

/**
 * Impacto háptico ligero al marcar "Hecho" o completar un paso.
 * Envuelto de forma segura para no fallar nunca en el navegador del PC.
 */
export async function triggerLightHaptic(): Promise<void> {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Fallback silencioso en navegador de escritorio
  }
}

/**
 * Notificación háptica de éxito al completar todas las tareas aplicables del día.
 * Envuelto de forma segura para no fallar nunca en el navegador del PC.
 */
export async function triggerSuccessHaptic(): Promise<void> {
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // Fallback silencioso en navegador de escritorio
  }
}

// @end: Native-Haptics-And-StatusBar-Bridge
