// @section: Notification-Adapter

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { GlobalSettings, ScheduledPrompt } from '../core/types';
import { getPreviouslyScheduledIds, saveScheduledIds } from './storage';

export const ACTION_TYPE_ROUTINE_DEFAULT = 'ROUTINE_DEFAULT_ACTIONS';
export const ACTION_TYPE_ROUTINE_NOT_AT_HOME = 'ROUTINE_NOT_AT_HOME_ACTIONS';

export async function requestNotificationPermissions(): Promise<{
  granted: boolean;
  status: string;
}> {
  try {
    if (!Capacitor.isNativePlatform()) {
      if ('Notification' in window) {
        const res = await Notification.requestPermission();
        return { granted: res === 'granted', status: res };
      }
      return { granted: true, status: 'web-simulated' };
    }
    const perm = await LocalNotifications.requestPermissions();
    return {
      granted: perm.display === 'granted',
      status: perm.display,
    };
  } catch (err) {
    return { granted: false, status: String(err) };
  }
}

export async function registerNotificationCategories(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: ACTION_TYPE_ROUTINE_DEFAULT,
          actions: [
            {
              id: 'DONE',
              title: 'Hecho',
              foreground: false,
            },
          ],
        },
        {
          id: ACTION_TYPE_ROUTINE_NOT_AT_HOME,
          actions: [
            {
              id: 'DONE',
              title: 'Hecho',
              foreground: false,
            },
            {
              id: 'NOT_AT_HOME',
              title: 'No estoy en casa (+1h)',
              foreground: false,
            },
          ],
        },
      ],
    });
  } catch {
    // Fallback limpio en web o si no está soportado
  }
}

/**
 * Sincroniza de forma determinista todos los avisos en `@capacitor/local-notifications`.
 * 1. Cancela todos los IDs numéricos registrados previamente + cualquier pendiente en el sistema.
 * 2. Agenda la nueva lista de los próximos 7 días (sin dejar alarmas huérfanas).
 */
export async function syncSystemNotifications(
  prompts: ScheduledPrompt[],
  settings: GlobalSettings
): Promise<{ scheduledCount: number }> {
  const prev = await getPreviouslyScheduledIds();

  if (Capacitor.isNativePlatform()) {
    try {
      const pending = await LocalNotifications.getPending();
      const idsToCancel = new Set<number>(prev.numericIds);
      for (const p of pending.notifications) {
        idsToCancel.add(p.id);
      }
      if (idsToCancel.size > 0) {
        await LocalNotifications.cancel({
          notifications: Array.from(idsToCancel).map((id) => ({ id })),
        });
      }

      if (prompts.length > 0) {
        await LocalNotifications.schedule({
          notifications: prompts.map((p) => {
            const hasNotAtHome = p.actions.includes('NOT_AT_HOME');
            const isInsistence =
              p.kind === 'insistence' || p.kind === 'secondary_insistence';
            return {
              id: p.notificationNumericId,
              title: isInsistence
                ? `⏰ Insistencia: ${p.routineName}`
                : `🔔 ${p.routineName}`,
              body: hasNotAtHome
                ? 'Marca "Hecho" o "No estoy en casa" para posponer 1 hora (máx. 22:00).'
                : 'Pendiente de marcar como "Hecho". Seguirá avisando cada 10 min.',
              schedule: {
                at: new Date(p.scheduledAtISO),
                allowWhileIdle: true,
              },
              actionTypeId: hasNotAtHome
                ? ACTION_TYPE_ROUTINE_NOT_AT_HOME
                : ACTION_TYPE_ROUTINE_DEFAULT,
              extra: {
                deterministicId: p.deterministicId,
                routineId: p.routineId,
                dateKey: p.dateKey,
                kind: p.kind,
                interruptionLevel: settings.useTimeSensitiveEntitlement
                  ? 'timeSensitive'
                  : 'active',
              },
            };
          }),
        });
      }
    } catch {
      // Ignorar errores de plugin en entorno web
    }
  }

  await saveScheduledIds({
    numericIds: prompts.map((p) => p.notificationNumericId),
    alarmUuids: prompts.map((p) => p.alarmUuid),
  });

  return { scheduledCount: prompts.length };
}

// @end: Notification-Adapter
