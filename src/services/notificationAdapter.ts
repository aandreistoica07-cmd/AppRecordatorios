// @section: Notification-Adapter

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type {
  AlarmKitStatus,
  GlobalSettings,
  PermissionGrantLabel,
  ScheduledPrompt,
  SystemNotificationPermissions,
} from '../core/types';
import {
  getAlarmKitNativeStatus,
  requestAlarmKitAuthorization,
  scheduleAlarmKitAlarm,
} from './alarmKitClient';
import { getPreviouslyScheduledIds, saveScheduledIds } from './storage';

export const ACTION_TYPE_ROUTINE_DEFAULT = 'ROUTINE_DEFAULT_ACTIONS';
export const DEFAULT_NOTIFICATION_SOUND = 'default.wav';
export const SIDELOAD_EXPIRY_NOTIFICATION_ID = 999007;

type ForegroundNotificationCallback = (payload: {
  id: number;
  title: string;
  body: string;
}) => void;

export interface NotificationActionPayload {
  actionId: string;
  routineId?: string;
  dateKey?: string;
  kind?: string;
  notificationId?: number;
}

type NotificationActionCallback = (payload: NotificationActionPayload) => void;

let foregroundNotifCallback: ForegroundNotificationCallback | null = null;

function mapPermissionStateToLabel(state: unknown): PermissionGrantLabel {
  const normalized = String(state ?? '').toLowerCase();
  if (
    normalized === 'granted' ||
    normalized === 'authorized' ||
    normalized === 'provisional' ||
    normalized === 'ephemeral'
  ) {
    return 'Concedido';
  }
  if (normalized === 'denied') {
    return 'Denegado';
  }
  return 'Pendiente';
}

/**
 * Detecta si el plugin nativo `AlarmKit` (Fase 3) está registrado en Capacitor y autorizado por el usuario.
 * Mientras no exista o no esté autorizado, devuelve `{ available: false, authorized: false }`.
 */
export async function getAlarmKitStatus(): Promise<AlarmKitStatus> {
  const status = await getAlarmKitNativeStatus();
  return {
    available: status.available,
    authorized: status.authorized,
  };
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

/**
 * Registra los tipos de acción en `@capacitor/local-notifications`:
 * - Botones: "Hecho" (`DONE`), "Posponer 1 h" (`POSTPONE_1H`) y "Pausar avisos 2 h" (`PAUSE_2H`).
 * - IMPORTANTE (`foreground: true`): En iOS (`UNNotificationActionOptions.foreground`), una app Capacitor
 *   ejecuta la lógica de negocio en el hilo JS de `WKWebView`. Con la app cerrada o suspendida y `foreground: false`,
 *   el delegado nativo de Capacitor (`LocalNotificationsHandler.swift`) llama a `notifyListeners(..., retainUntilConsumed: true)`
 *   y cierra inmediatamente el `completionHandler()` de iOS antes de que el WebView pueda hidratar React, leer `Preferences`
 *   y reprogramar la cola en `UNUserNotificationCenter`. Con `foreground: true`, al pulsar cualquiera de los botones
 *   se abre la app y se aplica la acción de forma inmediata y garantizada sobre la tarea de la notificación.
 */
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
              foreground: true,
            },
            {
              id: 'POSTPONE_1H',
              title: 'Posponer 1 h',
              foreground: true,
            },
            {
              id: 'PAUSE_2H',
              title: 'Pausar avisos 2 h',
              foreground: true,
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
          kind: typeof extra.kind === 'string' ? extra.kind : undefined,
          notificationId:
            typeof event.notification?.id === 'number'
              ? event.notification.id
              : undefined,
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
 * - Agrupación por rutina:
 *   - En iOS, `@capacitor/local-notifications` mapea `threadIdentifier` a `UNMutableNotificationContent.threadIdentifier`
 *     y `summaryArgument` a `UNMutableNotificationContent.summaryArgument` (`LocalNotificationsPlugin.swift` líneas 254-260).
 *   - En Android, mapea `group` a `NotificationCompat.Builder.setGroup()`.
 *   Se incluyen ambos (`threadIdentifier` y `group`) para agrupar todas las notificaciones de una misma rutina.
 */
export function buildLocalNotificationPayload(
  p: ScheduledPrompt,
  settings: GlobalSettings
) {
  const isInsistence =
    p.kind === 'insistence' || p.kind === 'secondary_insistence';
  const isPauseRecovery = p.kind === 'pause_recovery';
  const groupKey = isPauseRecovery
    ? 'routine-pause-recovery'
    : `routine-${p.routineId}`;

  const title = isPauseRecovery
    ? `🔔 Fin de pausa · ${p.routineName}`
    : isInsistence
    ? `⏰ Insistencia: ${p.routineName}`
    : `🔔 ${p.routineName}`;

  const body = isPauseRecovery
    ? 'La pausa de avisos ha terminado. Revisa tus tareas pendientes de hoy.'
    : 'Pendiente de marcar como "Hecho". Puedes posponer 1 h o pausar 2 h.';

  return {
    id: p.notificationNumericId,
    title,
    body,
    sound: DEFAULT_NOTIFICATION_SOUND,
    silent: false,
    threadIdentifier: groupKey,
    summaryArgument: p.routineName,
    group: groupKey,
    schedule: {
      at: new Date(p.scheduledAtISO),
      allowWhileIdle: true,
    },
    actionTypeId: ACTION_TYPE_ROUTINE_DEFAULT,
    extra: {
      deterministicId: p.deterministicId,
      routineId: p.routineId,
      dateKey: p.dateKey,
      kind: p.kind,
      threadIdentifier: groupKey,
      interruptionLevel: settings.useTimeSensitiveEntitlement
        ? 'timeSensitive'
        : 'active',
    },
  };
}

function doesExtraMatchRoutine(
  extra: Record<string, unknown>,
  routineId: string
): boolean {
  if (extra.routineId === routineId) return true;
  if (
    typeof extra.routineId === 'string' &&
    extra.routineId
      .split(',')
      .map((s) => s.trim())
      .includes(routineId)
  ) {
    return true;
  }
  return false;
}

/**
 * Elimina las notificaciones YA ENTREGADAS en el Centro de Notificaciones de iOS
 * y cancela las PENDIENTES para una rutina concreta (al marcar Hecho, posponer o eliminar),
 * o para todas las rutinas activas cuando se inicia una pausa (`routineId === undefined`).
 */
export async function clearRoutineDeliveredAndPendingNotifications(
  routineId?: string,
  knownNumericIds: number[] = []
): Promise<{ removedDeliveredIds: number[]; cancelledPendingIds: number[] }> {
  const removedDeliveredIds = new Set<number>();
  const cancelledPendingIds = new Set<number>(knownNumericIds);

  if (Capacitor.isNativePlatform()) {
    try {
      const delivered = await LocalNotifications.getDeliveredNotifications();
      for (const d of delivered.notifications) {
        const extra = (d.extra ?? {}) as Record<string, unknown>;
        if (!routineId) {
          // Si es pausa global, limpiamos todas las notificaciones de rutinas entregadas (excepto aviso de Sideloadly)
          if (d.id !== SIDELOAD_EXPIRY_NOTIFICATION_ID) {
            removedDeliveredIds.add(d.id);
          }
        } else if (
          doesExtraMatchRoutine(extra, routineId) ||
          knownNumericIds.includes(d.id)
        ) {
          removedDeliveredIds.add(d.id);
        }
      }
      if (removedDeliveredIds.size > 0) {
        await LocalNotifications.removeDeliveredNotifications({
          notifications: Array.from(removedDeliveredIds).map((id) => ({
            id,
            title: '',
            body: '',
          })),
        });
      }
    } catch {
      // Ignorar si no está soportado en entorno web
    }

    try {
      const pending = await LocalNotifications.getPending();
      for (const p of pending.notifications) {
        const extra = (p.extra ?? {}) as Record<string, unknown>;
        if (!routineId) {
          if (p.id !== SIDELOAD_EXPIRY_NOTIFICATION_ID) {
            cancelledPendingIds.add(p.id);
          }
        } else if (doesExtraMatchRoutine(extra, routineId)) {
          cancelledPendingIds.add(p.id);
        }
      }
      if (cancelledPendingIds.size > 0) {
        await LocalNotifications.cancel({
          notifications: Array.from(cancelledPendingIds).map((id) => ({ id })),
        });
      }
    } catch {
      // Ignorar en entorno web
    }
  }

  return {
    removedDeliveredIds: Array.from(removedDeliveredIds),
    cancelledPendingIds: Array.from(cancelledPendingIds),
  };
}

/**
 * Cancela explícitamente por ID todas las alarmas/notificaciones (entregadas y pendientes) de una rutina eliminada.
 */
export async function cancelRoutineNotificationsById(
  routineId: string,
  knownNumericIds: number[] = []
): Promise<number[]> {
  const { cancelledPendingIds } =
    await clearRoutineDeliveredAndPendingNotifications(
      routineId,
      knownNumericIds
    );

  const prev = await getPreviouslyScheduledIds();
  const cancelledSet = new Set(cancelledPendingIds);
  await saveScheduledIds({
    numericIds: prev.numericIds.filter((id) => !cancelledSet.has(id)),
    alarmUuids: prev.alarmUuids,
  });

  return cancelledPendingIds;
}

/**
 * Programa el aviso del día 6 tras reinstalar con Sideloadly:
 * "La app caduca mañana: reinstálala con Sideloadly".
 */
export async function scheduleSideloadExpiryWarning(
  lastReinstallISO: string | undefined,
  useTimeSensitiveEntitlement: boolean = false
): Promise<{ scheduled: boolean; triggerDate?: Date }> {
  if (!lastReinstallISO) return { scheduled: false };
  const installedMs = new Date(lastReinstallISO).getTime();
  if (Number.isNaN(installedMs)) return { scheduled: false };

  const day6Date = new Date(installedMs + 6 * 24 * 3600_000);
  if (day6Date.getTime() <= Date.now()) {
    return { scheduled: false, triggerDate: day6Date };
  }

  if (Capacitor.isNativePlatform()) {
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: SIDELOAD_EXPIRY_NOTIFICATION_ID }],
      });
      await LocalNotifications.schedule({
        notifications: [
          {
            id: SIDELOAD_EXPIRY_NOTIFICATION_ID,
            title: '⚠️ Firma de la app',
            body: 'La app caduca mañana: reinstálala con Sideloadly',
            sound: DEFAULT_NOTIFICATION_SOUND,
            silent: false,
            threadIdentifier: 'sideload-signature',
            group: 'sideload-signature',
            schedule: {
              at: day6Date,
              allowWhileIdle: true,
            },
            extra: {
              kind: 'sideload_expiry_warning',
              interruptionLevel: useTimeSensitiveEntitlement
                ? 'timeSensitive'
                : 'active',
            },
          },
        ],
      });
    } catch {
      // Ignorar en entorno web
    }
  }

  return { scheduled: true, triggerDate: day6Date };
}

/**
 * Sincroniza de forma determinista todos los avisos en `@capacitor/local-notifications`.
 * 1. Cancela todos los IDs numéricos registrados previamente + cualquier pendiente en el sistema (conservando el aviso de Sideloadly).
 * 2. Agenda la nueva lista de los próximos 7 días (sin dejar alarmas huérfanas), con agrupación por rutina y soporte en primer plano.
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
        if (p.id !== SIDELOAD_EXPIRY_NOTIFICATION_ID) {
          idsToCancel.add(p.id);
        }
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

      if (settings.lastSideloadReinstallISO) {
        await scheduleSideloadExpiryWarning(
          settings.lastSideloadReinstallISO,
          settings.useTimeSensitiveEntitlement
        );
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
            threadIdentifier: 'diagnostic-test',
            group: 'diagnostic-test',
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
 * Programa una alarma de prueba a +60 segundos desde ahora usando el plugin nativo AlarmKit (Fase 3a).
 * Devuelve el estado exacto del permiso (concedido o denegado), la hora programada, el UUID y el error exacto si falla.
 */
export async function scheduleTestAlarmInOneMinute(
  _settings?: GlobalSettings
): Promise<{
  ok: boolean;
  targetDate: Date;
  targetTimeHHMMSS: string;
  engine: 'alarmkit' | 'notification-fallback';
  permissionGranted: boolean;
  authorizationState: string;
  alarmUuid?: string;
  error?: string;
}> {
  const targetDate = new Date(Date.now() + 60_000);
  const targetTimeHHMMSS = formatHHMMSS(targetDate);

  const authRes = await requestAlarmKitAuthorization();
  if (!authRes.available) {
    return {
      ok: false,
      targetDate,
      targetTimeHHMMSS,
      engine: 'alarmkit',
      permissionGranted: false,
      authorizationState: authRes.authorizationState,
      error:
        authRes.error ??
        'AlarmKit no está disponible en este entorno (requiere iOS 26+).',
    };
  }

  if (!authRes.authorized) {
    return {
      ok: false,
      targetDate,
      targetTimeHHMMSS,
      engine: 'alarmkit',
      permissionGranted: false,
      authorizationState: authRes.authorizationState,
      error:
        authRes.error ??
        `Permiso de AlarmKit denegado (estado: ${authRes.authorizationState}). Actívalo en Ajustes de iOS.`,
    };
  }

  const schedRes = await scheduleAlarmKitAlarm({
    id: 'diagnostic-test-alarm',
    fechaISO: targetDate.toISOString(),
    etiqueta: 'Alarma de prueba · Rutinas',
  });

  if (!schedRes.ok) {
    return {
      ok: false,
      targetDate,
      targetTimeHHMMSS,
      engine: 'alarmkit',
      permissionGranted: true,
      authorizationState: schedRes.authorizationState,
      alarmUuid: schedRes.uuid,
      error: schedRes.error ?? 'Error desconocido al programar en AlarmKit.',
    };
  }

  return {
    ok: true,
    targetDate,
    targetTimeHHMMSS,
    engine: 'alarmkit',
    permissionGranted: true,
    authorizationState: schedRes.authorizationState,
    alarmUuid: schedRes.uuid,
  };
}

// @end: Notification-Adapter

