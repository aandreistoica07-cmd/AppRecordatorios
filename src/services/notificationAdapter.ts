// @section: Notification-Adapter

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type {
  GlobalSettings,
  PermissionGrantLabel,
  ScheduledPrompt,
  SystemNotificationPermissions,
} from '../core/types';
import { getPreviouslyScheduledIds, saveScheduledIds } from './storage';

export const ACTION_TYPE_ROUTINE_DEFAULT = 'ROUTINE_DEFAULT_ACTIONS';
export const ACTION_TYPE_ROUTINE_NOT_AT_HOME = 'ROUTINE_NOT_AT_HOME_ACTIONS';
export const DEFAULT_NOTIFICATION_SOUND = 'default.wav';

type ForegroundNotificationCallback = (payload: {
  id: number;
  title: string;
  body: string;
}) => void;

type NotificationActionCallback = (payload: {
  actionId: string;
  routineId?: string;
  dateKey?: string;
}) => void;

let foregroundNotifCallback: ForegroundNotificationCallback | null = null;

function mapPermissionStateToLabel(state: unknown): PermissionGrantLabel {
  const normalized = String(state ?? '').toLowerCase();
  if (normalized === 'granted' || normalized === 'authorized' || normalized === 'provisional' || normalized === 'ephemeral') {
    return 'Concedido';
  }
  if (normalized === 'denied') {
    return 'Denegado';
  }
  return 'Pendiente';
}

/**
 * Reproduce un tono audible mediante Web Audio API cuando llega un aviso con la app en primer plano
 * como refuerzo adicional a la presentación nativa [.badge, .sound, .alert] de iOS.
 */
export function playForegroundChime(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [880, 1174.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.22, now + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.25);
    });
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 700);
  } catch {
    // Fallback silencioso si el navegador bloquea AudioContext sin gesto previo
  }
}

/**
 * Lee el estado real de los permisos del sistema (alertas, sonido, insignias y centro de notificaciones)
 * directamente desde `@capacitor/local-notifications`.
 */
export async function getDetailedNotificationPermissions(): Promise<SystemNotificationPermissions> {
  try {
    if (!Capacitor.isNativePlatform()) {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        const perm = Notification.permission;
        const label = mapPermissionStateToLabel(perm);
        return {
          display: perm,
          enabledInNotificationCenter: perm === 'granted',
          alerts: label,
          sound: label,
          badges: label,
        };
      }
      return {
        display: 'granted',
        enabledInNotificationCenter: true,
        alerts: 'Concedido',
        sound: 'Concedido',
        badges: 'Concedido',
      };
    }

    const [permResult, enabledResult] = await Promise.all([
      LocalNotifications.checkPermissions(),
      LocalNotifications.areEnabled().catch(() => ({
        value: false,
      })),
    ]);

    const raw = permResult as unknown as Record<string, unknown>;
    const displayState = permResult.display ?? 'prompt';
    const isEnabled =
      typeof enabledResult?.value === 'boolean'
        ? enabledResult.value
        : displayState === 'granted';

    const effectiveDisplay =
      displayState === 'granted' && !isEnabled ? 'denied' : displayState;

    const alertsLabel = mapPermissionStateToLabel(
      raw.alert ?? raw.alerts ?? effectiveDisplay
    );
    const soundLabel = mapPermissionStateToLabel(
      raw.sound ?? effectiveDisplay
    );
    const badgesLabel = mapPermissionStateToLabel(
      raw.badge ?? raw.badges ?? effectiveDisplay
    );

    return {
      display: effectiveDisplay,
      enabledInNotificationCenter: isEnabled,
      alerts: alertsLabel,
      sound: soundLabel,
      badges: badgesLabel,
    };
  } catch {
    return {
      display: 'prompt',
      enabledInNotificationCenter: false,
      alerts: 'Pendiente',
      sound: 'Pendiente',
      badges: 'Pendiente',
    };
  }
}

export async function requestNotificationPermissions(): Promise<{
  granted: boolean;
  status: string;
  details: SystemNotificationPermissions;
}> {
  try {
    if (!Capacitor.isNativePlatform()) {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        const res = await Notification.requestPermission();
        const details = await getDetailedNotificationPermissions();
        return {
          granted: res === 'granted',
          status: res === 'granted' ? 'Concedido' : 'Denegado',
          details,
        };
      }
      const details = await getDetailedNotificationPermissions();
      return { granted: true, status: 'Concedido', details };
    }
    const perm = await LocalNotifications.requestPermissions();
    const details = await getDetailedNotificationPermissions();
    const granted = perm.display === 'granted';
    return {
      granted,
      status: granted ? 'Concedido' : 'Denegado',
      details,
    };
  } catch (err) {
    const details = await getDetailedNotificationPermissions();
    return { granted: false, status: String(err), details };
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
 * Registra listeners para notificaciones recibidas con la app en primer plano y acciones pulsadas.
 * Garantiza que cuando la app está abierta en primer plano se muestre el aviso visual y suene explícitamente.
 */
export async function setupNotificationListeners(handlers: {
  onForegroundReceived?: ForegroundNotificationCallback;
  onActionPerformed?: NotificationActionCallback;
}): Promise<() => void> {
  foregroundNotifCallback = handlers.onForegroundReceived ?? null;

  if (!Capacitor.isNativePlatform()) {
    return () => {
      foregroundNotifCallback = null;
    };
  }

  try {
    const receivedHandle = await LocalNotifications.addListener(
      'localNotificationReceived',
      (notification) => {
        playForegroundChime();
        handlers.onForegroundReceived?.({
          id: notification.id,
          title: notification.title,
          body: notification.body,
        });
      }
    );

    const actionHandle = await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (event) => {
        const extra = (event.notification?.extra ?? {}) as Record<
          string,
          unknown
        >;
        handlers.onActionPerformed?.({
          actionId: event.actionId,
          routineId:
            typeof extra.routineId === 'string' ? extra.routineId : undefined,
          dateKey:
            typeof extra.dateKey === 'string' ? extra.dateKey : undefined,
        });
      }
    );

    return () => {
      foregroundNotifCallback = null;
      void receivedHandle.remove();
      void actionHandle.remove();
    };
  } catch {
    return () => {
      foregroundNotifCallback = null;
    };
  }
}

/**
 * Construye el payload de una notificación local asegurando SIEMPRE:
 * - `sound: DEFAULT_NOTIFICATION_SOUND` explícito (sin él, iOS `UNMutableNotificationContent.sound` queda en nil y no suena).
 * - `silent: false` explícito (para que `willPresent` en iOS devuelva `[.badge, .sound, .alert]` también en primer plano).
 */
export function buildLocalNotificationPayload(
  p: ScheduledPrompt,
  settings: GlobalSettings
) {
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
    sound: DEFAULT_NOTIFICATION_SOUND,
    silent: false,
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
}

/**
 * Cancela explícitamente por ID todas las alarmas/notificaciones de una rutina eliminada.
 */
export async function cancelRoutineNotificationsById(
  routineId: string,
  knownNumericIds: number[] = []
): Promise<number[]> {
  const idsToCancel = new Set<number>(knownNumericIds);

  if (Capacitor.isNativePlatform()) {
    try {
      const pending = await LocalNotifications.getPending();
      for (const p of pending.notifications) {
        const extra = (p.extra ?? {}) as Record<string, unknown>;
        if (
          extra.routineId === routineId ||
          (typeof extra.routineId === 'string' &&
            extra.routineId.split(',').includes(routineId))
        ) {
          idsToCancel.add(p.id);
        }
      }
      if (idsToCancel.size > 0) {
        await LocalNotifications.cancel({
          notifications: Array.from(idsToCancel).map((id) => ({ id })),
        });
      }
    } catch {
      // Ignorar errores en entorno web
    }
  }

  const prev = await getPreviouslyScheduledIds();
  await saveScheduledIds({
    numericIds: prev.numericIds.filter((id) => !idsToCancel.has(id)),
    alarmUuids: prev.alarmUuids,
  });

  return Array.from(idsToCancel);
}

/**
 * Sincroniza de forma determinista todos los avisos en `@capacitor/local-notifications`.
 * 1. Cancela todos los IDs numéricos registrados previamente + cualquier pendiente en el sistema.
 * 2. Agenda la nueva lista de los próximos 7 días (sin dejar alarmas huérfanas), con sonido explícito y soporte en primer plano.
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
          notifications: prompts.map((p) =>
            buildLocalNotificationPayload(p, settings)
          ),
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

const TEST_NOTIFICATION_ID = 999001;
const TEST_ALARM_FALLBACK_ID = 999002;

function formatHHMMSS(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Programa un aviso de prueba (notificación local) a +60 segundos desde ahora con sonido explícito y soporte en primer plano.
 */
export async function scheduleTestNotificationInOneMinute(
  settings: GlobalSettings
): Promise<{ targetDate: Date; targetTimeHHMMSS: string }> {
  const targetDate = new Date(Date.now() + 60_000);
  const targetTimeHHMMSS = formatHHMMSS(targetDate);
  const title = '🔔 Aviso de prueba · Rutinas';
  const body = `Notificación local programada para las ${targetTimeHHMMSS}.`;

  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: TEST_NOTIFICATION_ID }],
      });
      await LocalNotifications.schedule({
        notifications: [
          {
            id: TEST_NOTIFICATION_ID,
            title,
            body,
            sound: DEFAULT_NOTIFICATION_SOUND,
            silent: false,
            schedule: {
              at: targetDate,
              allowWhileIdle: true,
            },
            actionTypeId: ACTION_TYPE_ROUTINE_DEFAULT,
            extra: {
              isDiagnosticTest: true,
              kind: 'test_notification',
              interruptionLevel: settings.useTimeSensitiveEntitlement
                ? 'timeSensitive'
                : 'active',
            },
          },
        ],
      });
    } catch {
      // Ignorar si falla en web
    }
  } else if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      playForegroundChime();
      foregroundNotifCallback?.({
        id: TEST_NOTIFICATION_ID,
        title,
        body,
      });
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    }, 60_000);
  }

  return { targetDate, targetTimeHHMMSS };
}

/**
 * Programa una alarma de prueba a +60 segundos desde ahora con sonido explícito y soporte en primer plano.
 * En la Fase 3 usará AlarmKit nativo en iOS 26; mientras tanto usa notificación local como respaldo.
 */
export async function scheduleTestAlarmInOneMinute(
  settings: GlobalSettings
): Promise<{
  targetDate: Date;
  targetTimeHHMMSS: string;
  engine: 'alarmkit' | 'notification-fallback';
}> {
  const targetDate = new Date(Date.now() + 60_000);
  const targetTimeHHMMSS = formatHHMMSS(targetDate);
  const title = '⏰ Alarma de prueba · Rutinas';
  const body = `Alarma de prueba programada para las ${targetTimeHHMMSS}.`;

  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: TEST_ALARM_FALLBACK_ID }],
      });
      await LocalNotifications.schedule({
        notifications: [
          {
            id: TEST_ALARM_FALLBACK_ID,
            title,
            body,
            sound: DEFAULT_NOTIFICATION_SOUND,
            silent: false,
            schedule: {
              at: targetDate,
              allowWhileIdle: true,
            },
            actionTypeId: ACTION_TYPE_ROUTINE_DEFAULT,
            extra: {
              isDiagnosticTest: true,
              kind: 'test_alarm',
              interruptionLevel: settings.useTimeSensitiveEntitlement
                ? 'timeSensitive'
                : 'active',
            },
          },
        ],
      });
    } catch {
      // Ignorar si falla en web
    }
  } else if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      playForegroundChime();
      foregroundNotifCallback?.({
        id: TEST_ALARM_FALLBACK_ID,
        title,
        body,
      });
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    }, 60_000);
  }

  return {
    targetDate,
    targetTimeHHMMSS,
    engine: 'notification-fallback',
  };
}

// @end: Notification-Adapter

