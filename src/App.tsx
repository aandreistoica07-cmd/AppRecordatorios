// @section: Main-App-Container

import React, { useEffect, useRef, useState } from 'react';
import { HistoryScreen } from './components/HistoryScreen';
import { Icon } from './components/Icon';
import { RoutinesScreen } from './components/RoutinesScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { TodayScreen } from './components/TodayScreen';
import { UpcomingAlarmsScreen } from './components/UpcomingAlarmsScreen';
import {
  DEFAULT_BLOCKING_RULES,
  DEFAULT_GLOBAL_SETTINGS,
  createInitialRoutines,
} from './core/defaults';
import {
  computeCurrentStreakDays,
  computeSchedule,
  deleteRoutineAndCleanup,
  evaluateDaySummary,
  formatDateKey,
  formatHHMM,
  markRoutineDone,
  postponeRoutineNotAtHome,
  postponeRoutineTask,
  resetRoutinePostpone,
  toggleChecklistStep,
  unmarkRoutineDone,
} from './core/scheduler';
import type {
  ActiveNoticeMode,
  AlarmKitStatus,
  BlockingRule,
  GlobalSettings,
  RoutineConfig,
  RoutineDayRecord,
  SystemNotificationPermissions,
} from './core/types';
import {
  configureNativeStatusBar,
  triggerLightHaptic,
  triggerSuccessHaptic,
} from './services/deviceBridge';
import {
  cancelRoutineNotificationsById,
  clearRoutineDeliveredAndPendingNotifications,
  getAlarmKitStatus,
  getDetailedNotificationPermissions,
  registerNotificationCategories,
  requestNotificationPermissions,
  scheduleSideloadExpiryWarning,
  setupNotificationListeners,
  syncSystemNotifications,
} from './services/notificationAdapter';
import { loadAppState, saveAppState } from './services/storage';

type TabKey = 'today' | 'routines' | 'upcoming' | 'history' | 'settings';

interface QueuedNotificationAction {
  actionId: string;
  routineId?: string;
  routineIds?: string[];
  dateKey?: string;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const param = new URLSearchParams(window.location.search).get('tab');
    if (
      param === 'today' ||
      param === 'routines' ||
      param === 'upcoming' ||
      param === 'history' ||
      param === 'settings'
    ) {
      return param;
    }
    return 'today';
  });
  const [now, setNow] = useState<Date>(() => new Date());
  const [hydrated, setHydrated] = useState(false);

  const [settings, setSettings] = useState<GlobalSettings>(
    DEFAULT_GLOBAL_SETTINGS
  );
  const [routines, setRoutines] = useState<RoutineConfig[]>(() =>
    createInitialRoutines(DEFAULT_GLOBAL_SETTINGS)
  );
  const [blockingRules, setBlockingRules] = useState<BlockingRule[]>(
    DEFAULT_BLOCKING_RULES
  );
  const [records, setRecords] = useState<RoutineDayRecord[]>([]);
  const [noticeMode, setNoticeMode] = useState<ActiveNoticeMode>({
    type: 'alarm',
  });
  const [alarmKitStatus, setAlarmKitStatus] = useState<AlarmKitStatus>({
    available: false,
    authorized: false,
  });
  const [permissionStatus, setPermissionStatus] = useState<string>('Pendiente');
  const [permissionDetails, setPermissionDetails] =
    useState<SystemNotificationPermissions>({
      display: 'prompt',
      enabledInNotificationCenter: false,
      alerts: 'Pendiente',
      sound: 'Pendiente',
      badges: 'Pendiente',
    });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const pendingActionsRef = useRef<QueuedNotificationAction[]>([]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const refreshPermissionState = async () => {
    const [details, akStatus] = await Promise.all([
      getDetailedNotificationPermissions(),
      getAlarmKitStatus(),
    ]);
    setPermissionDetails(details);
    setAlarmKitStatus(akStatus);
    setPermissionStatus(
      details.display === 'granted'
        ? 'Concedido'
        : details.display === 'denied'
        ? 'Denegado'
        : 'Pendiente'
    );
  };

  // Cargar datos de @capacitor/preferences y configurar StatusBar al abrir la app
  useEffect(() => {
    let mounted = true;
    (async () => {
      await configureNativeStatusBar();
      await registerNotificationCategories();
      const [loaded, permDetails, akStatus] = await Promise.all([
        loadAppState(),
        getDetailedNotificationPermissions(),
        getAlarmKitStatus(),
      ]);
      if (!mounted) return;
      setSettings(loaded.settings);
      setRoutines(loaded.routines);
      setBlockingRules(loaded.blockingRules);
      setRecords(loaded.records);
      setNoticeMode(loaded.noticeMode);
      setPermissionDetails(permDetails);
      setAlarmKitStatus(akStatus);
      setPermissionStatus(
        permDetails.display === 'granted'
          ? 'Concedido'
          : permDetails.display === 'denied'
          ? 'Denegado'
          : 'Pendiente'
      );
      setHydrated(true);
    })();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshPermissionState();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Reloj en vivo cada segundo para la cuenta atrás del modo discreto / pausa
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Cálculo reactivo del planificador de 7 días
  const scheduleResult = computeSchedule({
    now,
    routines,
    blockingRules,
    records,
    settings,
    noticeMode,
  });

  const getRoutineActiveNumericIds = (
    routineId: string,
    dateKey?: string
  ): number[] => {
    return scheduleResult.activePromptsToSchedule
      .filter(
        (p) =>
          p.routineId === routineId &&
          (dateKey ? p.dateKey === dateKey : true)
      )
      .map((p) => p.notificationNumericId);
  };

  const executeNotificationAction = (action: QueuedNotificationAction) => {
    const { actionId, routineId, routineIds, dateKey } = action;
    const effectiveDateKey = dateKey ?? formatDateKey(new Date());

    if (actionId === 'PAUSE_2H') {
      const untilDate = new Date(Date.now() + 2 * 3600_000);
      const targetHHMM = formatHHMM(
        untilDate.getHours(),
        untilDate.getMinutes()
      );
      if (routineId) {
        void clearRoutineDeliveredAndPendingNotifications(
          routineId,
          getRoutineActiveNumericIds(routineId)
        );
      }
      setNoticeMode({
        type: 'paused',
        startedAtISO: new Date().toISOString(),
        untilISO: untilDate.toISOString(),
        targetHHMM,
      });
      showToast(`⏸ Avisos pausados 2 h (hasta las ${targetHHMM}).`);
      return;
    }

    // Si viene de un aviso resumen post-pausa y solo hay una rutina o varias en routineIds
    const candidateRoutineIds =
      routineId && routineId !== 'pause_recovery'
        ? [routineId]
        : routineIds && routineIds.length > 0
        ? routineIds
        : [];

    if (candidateRoutineIds.length === 0) return;

    for (const rId of candidateRoutineIds) {
      const targetRoutine = routines.find((r) => r.id === rId);
      if (!targetRoutine) continue;

      if (actionId === 'DONE') {
        handleMarkDone(targetRoutine, effectiveDateKey);
      } else if (actionId === 'POSTPONE_1H') {
        handlePostponeTask(targetRoutine, effectiveDateKey, {
          type: 'add_hours',
          hours: 1,
        });
      } else if (actionId === 'NOT_AT_HOME') {
        handlePostponeNotAtHome(targetRoutine, effectiveDateKey);
      }
    }
  };

  // Escuchar notificaciones recibidas en primer plano y botones de acción rápida
  useEffect(() => {
    const cleanupPromise = setupNotificationListeners({
      onForegroundReceived: ({ title, body }) => {
        showToast(`🔔 ${title}: ${body}`);
      },
      onActionPerformed: (payload) => {
        if (!hydrated) {
          pendingActionsRef.current.push(payload);
          return;
        }
        executeNotificationAction(payload);
      },
    });
    return () => {
      void cleanupPromise.then((cleanup) => cleanup());
    };
  }, [hydrated, routines, records, settings, blockingRules]);

  // Procesar acciones de notificación encoladas durante el arranque en frío
  useEffect(() => {
    if (!hydrated || pendingActionsRef.current.length === 0) return;
    const queued = [...pendingActionsRef.current];
    pendingActionsRef.current = [];
    for (const action of queued) {
      executeNotificationAction(action);
    }
  }, [hydrated]);

  // Guardar y reprogramar avisos tras cada acción o cambio de ajustes/modo
  useEffect(() => {
    if (!hydrated) return;

    const todayKey = formatDateKey(now);
    const activeAutoOmittedSet = new Set(
      scheduleResult.autoOmittedRecords.map(
        (r) => `${r.routineId}__${r.dateKey}`
      )
    );

    // Sincronizar registros 'omitted_by_block': añadir nuevos y limpiar los de hoy/futuro que ya no estén bloqueados
    let changed = false;
    const copy = records.filter((rec) => {
      if (rec.status === 'omitted_by_block' && rec.dateKey >= todayKey) {
        const stillBlocked = activeAutoOmittedSet.has(
          `${rec.routineId}__${rec.dateKey}`
        );
        if (!stillBlocked) {
          changed = true;
          return false;
        }
      }
      return true;
    });

    for (const autoRec of scheduleResult.autoOmittedRecords) {
      const idx = copy.findIndex(
        (r) =>
          r.routineId === autoRec.routineId && r.dateKey === autoRec.dateKey
      );
      if (idx === -1) {
        copy.push(autoRec);
        changed = true;
      } else if (
        copy[idx].status !== 'omitted_by_block' &&
        copy[idx].status !== 'completed'
      ) {
        copy[idx] = autoRec;
        changed = true;
      }
    }

    const updatedRecords = changed ? copy : records;
    if (changed) {
      setRecords(copy);
    }

    // Si el modo discreto o pausa ha caducado, persistir la vuelta al modo alarma
    if (
      noticeMode.type !== 'alarm' &&
      scheduleResult.effectiveMode.type === 'alarm'
    ) {
      setNoticeMode({ type: 'alarm' });
    }

    void saveAppState({
      settings,
      routines,
      blockingRules,
      records: updatedRecords,
      noticeMode: scheduleResult.effectiveMode,
    });

    void syncSystemNotifications(
      scheduleResult.activePromptsToSchedule,
      settings
    );
  }, [
    hydrated,
    settings,
    routines,
    blockingRules,
    records,
    noticeMode,
    scheduleResult.activePromptsToSchedule.length,
    scheduleResult.effectiveMode.type,
  ]);

  const upsertRecordAndCheckCompletion = (
    nextRecord: RoutineDayRecord,
    dateKey: string
  ) => {
    setRecords((prev) => {
      const idx = prev.findIndex(
        (r) =>
          r.routineId === nextRecord.routineId &&
          r.dateKey === nextRecord.dateKey
      );
      const nextRecords =
        idx === -1
          ? [...prev, nextRecord]
          : prev.map((r, i) => (i === idx ? nextRecord : r));

      if (nextRecord.status === 'completed') {
        const summary = evaluateDaySummary(
          dateKey,
          formatDateKey(now),
          routines,
          nextRecords,
          blockingRules,
          settings
        );
        if (summary.overallStatus === 'completed') {
          void triggerSuccessHaptic();
        } else {
          void triggerLightHaptic();
        }
      } else {
        void triggerLightHaptic();
      }
      return nextRecords;
    });
  };

  const handleMarkDone = (routine: RoutineConfig, dateKey: string) => {
    const existing = records.find(
      (r) => r.routineId === routine.id && r.dateKey === dateKey
    );
    const res = markRoutineDone(routine, existing, dateKey, new Date());
    if (res.error) {
      showToast(res.error);
      return;
    }
    void clearRoutineDeliveredAndPendingNotifications(
      routine.id,
      getRoutineActiveNumericIds(routine.id, dateKey)
    );
    upsertRecordAndCheckCompletion(res.record, dateKey);
    showToast(`✓ ${routine.name} marcado como Hecho. Alarmas del día canceladas.`);
  };

  const handleUndoDone = (routine: RoutineConfig, dateKey: string) => {
    const hadBlockedDependents = records.some(
      (r) =>
        r.status === 'omitted_by_block' && r.blockedByRoutineId === routine.id
    );
    const nextRecords = unmarkRoutineDone(
      routine.id,
      dateKey,
      records,
      routines,
      blockingRules,
      settings
    );
    const stillHasBlockedDependents = nextRecords.some(
      (r) =>
        r.status === 'omitted_by_block' && r.blockedByRoutineId === routine.id
    );

    void triggerLightHaptic();
    setRecords(nextRecords);

    if (hadBlockedDependents && !stillHasBlockedDependents) {
      showToast(
        `↩ ${routine.name} vuelve a pendiente. Bloqueo de 24h anulado y alarmas reprogramadas.`
      );
    } else if (routine.secondarySchedule) {
      showToast(
        `↩ ${routine.name} vuelve a pendiente. Aviso de tarde (${routine.secondarySchedule.timeHHMM}) reprogramado.`
      );
    } else {
      showToast(`↩ ${routine.name} vuelve a pendiente. Alarmas reprogramadas.`);
    }
  };

  const handleDeleteRoutine = (routineId: string) => {
    const targetName =
      routines.find((r) => r.id === routineId)?.name ?? routineId;
    const res = deleteRoutineAndCleanup({
      routineId,
      todayKey: formatDateKey(now),
      routines,
      blockingRules,
      records,
      activePrompts: scheduleResult.activePromptsToSchedule,
    });
    void triggerLightHaptic();
    void cancelRoutineNotificationsById(routineId, res.cancelledNumericIds);
    setRoutines(res.routines);
    setBlockingRules(res.blockingRules);
    setRecords(res.records);
    showToast(
      `Rutina "${targetName}" eliminada. Alarmas canceladas e historial conservado.`
    );
  };

  const handleToggleChecklistStep = (
    routine: RoutineConfig,
    dateKey: string,
    stepId: string
  ) => {
    const existing = records.find(
      (r) => r.routineId === routine.id && r.dateKey === dateKey
    );
    const res = toggleChecklistStep(
      routine,
      existing,
      dateKey,
      stepId,
      new Date()
    );
    if (res.error) {
      showToast(res.error);
      return;
    }
    if (res.record.status === 'completed') {
      void clearRoutineDeliveredAndPendingNotifications(
        routine.id,
        getRoutineActiveNumericIds(routine.id, dateKey)
      );
    }
    upsertRecordAndCheckCompletion(res.record, dateKey);
    if (res.record.status === 'completed') {
      showToast(
        `✓ ${routine.name} completado. Bloqueo de 24h activado para tareas dependientes.`
      );
    }
  };

  const handlePostponeTask = (
    routine: RoutineConfig,
    dateKey: string,
    mode:
      | { type: 'add_hours'; hours: number }
      | { type: 'until_time'; targetHHMM: string }
  ) => {
    const existing = records.find(
      (r) => r.routineId === routine.id && r.dateKey === dateKey
    );
    const res = postponeRoutineTask({
      routine,
      existingRecord: existing,
      dateKey,
      now: new Date(),
      settings,
      mode,
    });
    void triggerLightHaptic();
    void clearRoutineDeliveredAndPendingNotifications(
      routine.id,
      getRoutineActiveNumericIds(routine.id, dateKey)
    );
    setRecords((prev) => {
      const idx = prev.findIndex(
        (r) =>
          r.routineId === res.record.routineId &&
          r.dateKey === res.record.dateKey
      );
      if (idx === -1) return [...prev, res.record];
      const copy = [...prev];
      copy[idx] = res.record;
      return copy;
    });
    showToast(
      res.reachedCap
        ? `${routine.name} pospuesto al tope de dormir (${res.nextTimeHHMM}).`
        : `${routine.name} pospuesto a las ${res.nextTimeHHMM}. Insistencias previas canceladas.`
    );
  };

  const handleResetTaskPostpone = (routine: RoutineConfig, dateKey: string) => {
    const existing = records.find(
      (r) => r.routineId === routine.id && r.dateKey === dateKey
    );
    const updated = resetRoutinePostpone(existing);
    if (!updated) return;
    void triggerLightHaptic();
    setRecords((prev) =>
      prev.map((r) =>
        r.routineId === routine.id && r.dateKey === dateKey ? updated : r
      )
    );
    showToast(`Horario original de ${routine.name} restablecido.`);
  };

  const handlePostponeNotAtHome = (routine: RoutineConfig, dateKey: string) => {
    const existing = records.find(
      (r) => r.routineId === routine.id && r.dateKey === dateKey
    );
    const res = postponeRoutineNotAtHome(routine, existing, dateKey, new Date());
    void triggerLightHaptic();
    void clearRoutineDeliveredAndPendingNotifications(
      routine.id,
      getRoutineActiveNumericIds(routine.id, dateKey)
    );
    setRecords((prev) => {
      const idx = prev.findIndex(
        (r) =>
          r.routineId === res.record.routineId &&
          r.dateKey === res.record.dateKey
      );
      if (idx === -1) return [...prev, res.record];
      const copy = [...prev];
      copy[idx] = res.record;
      return copy;
    });
    showToast(
      res.reachedCap
        ? `Pospuesto al límite máximo de las ${res.nextTimeHHMM}.`
        : `No estoy en casa: aviso de tarde pospuesto a las ${res.nextTimeHHMM}.`
    );
  };

  const handleUpdateGlobalSettings = (next: GlobalSettings) => {
    const sleepChanged = next.sleepTimeHHMM !== settings.sleepTimeHHMM;
    setSettings(next);
    // Sincronizar también horarios de pastilla y dermastamp en la lista de rutinas
    setRoutines((prev) =>
      prev.map((r) => {
        if (r.id === 'pastilla') {
          return {
            ...r,
            fixedTimeHHMM: next.pillMorningTimeHHMM,
            secondarySchedule: r.secondarySchedule
              ? {
                  ...r.secondarySchedule,
                  timeHHMM: next.pillAfternoonTimeHHMM,
                }
              : undefined,
          };
        }
        if (r.id === 'dermastamp') {
          return {
            ...r,
            weekday: next.dermastampWeekday,
            fixedTimeHHMM: next.dermastampTimeHHMM,
          };
        }
        return r;
      })
    );
    // Si cambia la hora de dormir, limpiar posposiciones activas de hoy en rutinas relativas al sueño para evitar que superen el nuevo tope
    if (sleepChanged) {
      const todayKey = formatDateKey(now);
      const relativeIds = new Set(
        routines
          .filter((r) => r.scheduleType === 'relative_to_sleep')
          .map((r) => r.id)
      );
      setRecords((prev) =>
        prev.map((rec) => {
          if (
            rec.dateKey === todayKey &&
            relativeIds.has(rec.routineId) &&
            rec.postponedPrimaryTimeHHMM
          ) {
            return resetRoutinePostpone(rec) ?? rec;
          }
          return rec;
        })
      );
    }
    showToast('Ajustes actualizados y alarmas de 7 días reprogramadas.');
  };

  const handleMarkSideloadReinstalled = async () => {
    const reinstallISO = new Date().toISOString();
    const nextSettings: GlobalSettings = {
      ...settings,
      lastSideloadReinstallISO: reinstallISO,
    };
    setSettings(nextSettings);
    void triggerSuccessHaptic();
    await scheduleSideloadExpiryWarning(
      reinstallISO,
      nextSettings.useTimeSensitiveEntitlement
    );
    showToast(
      'Firma de 7 días registrada. Aviso programado para el día 6 ("La app caduca mañana").'
    );
  };

  const streakDays = computeCurrentStreakDays(
    formatDateKey(now),
    routines,
    records,
    blockingRules,
    settings
  );

  const shellThemeClass =
    activeTab === 'routines'
      ? 'theme-routines'
      : activeTab === 'upcoming'
      ? 'theme-upcoming'
      : activeTab === 'history'
      ? 'theme-history'
      : activeTab === 'settings'
      ? 'theme-settings'
      : '';

  return (
    <div className={`app-shell ${shellThemeClass}`}>
      {toastMessage && (
        <div className="floating-toast" role="status">
          <Icon
            name="CheckCircle"
            size={20}
            weight="fill"
            color="var(--color-pastilla)"
          />
          <span>{toastMessage}</span>
        </div>
      )}

      {activeTab === 'today' && (
        <TodayScreen
          now={now}
          routines={routines}
          records={records}
          blockingRules={blockingRules}
          settings={settings}
          effectiveMode={scheduleResult.effectiveMode}
          alarmKitStatus={alarmKitStatus}
          streakDays={streakDays}
          onMarkDone={handleMarkDone}
          onUndoDone={handleUndoDone}
          onToggleChecklistStep={handleToggleChecklistStep}
          onPostponeTask={handlePostponeTask}
          onResetTaskPostpone={handleResetTaskPostpone}
          onPostponeNotAtHome={handlePostponeNotAtHome}
          onActivateDiscreet={(untilDate) => {
            setNoticeMode({
              type: 'discreet',
              startedAtISO: new Date().toISOString(),
              untilISO: untilDate.toISOString(),
              discreetIntervalMinutes: 3,
            });
            showToast('Modo Discreto activado.');
          }}
          onActivatePause={(untilDate, targetHHMM) => {
            for (const r of routines) {
              void clearRoutineDeliveredAndPendingNotifications(
                r.id,
                getRoutineActiveNumericIds(r.id)
              );
            }
            setNoticeMode({
              type: 'paused',
              startedAtISO: new Date().toISOString(),
              untilISO: untilDate.toISOString(),
              targetHHMM,
            });
            showToast(`Avisos pausados hasta las ${targetHHMM}.`);
          }}
          onResetNoticeMode={() => {
            setNoticeMode({ type: 'alarm' });
            showToast('Modo Alarma restablecido.');
          }}
        />
      )}

      {activeTab === 'routines' && (
        <RoutinesScreen
          routines={routines}
          blockingRules={blockingRules}
          settings={settings}
          onUpdateRoutine={(updated) => {
            const prevRoutine = routines.find((r) => r.id === updated.id);
            if (!updated.enabled) {
              void clearRoutineDeliveredAndPendingNotifications(
                updated.id,
                getRoutineActiveNumericIds(updated.id)
              );
            }
            setRoutines((prev) =>
              prev.map((r) => (r.id === updated.id ? updated : r))
            );
            // Si el usuario cambió la hora fija de la rutina, limpiar cualquier posposición manual de hoy para que aplique la nueva hora
            if (
              prevRoutine &&
              prevRoutine.fixedTimeHHMM !== updated.fixedTimeHHMM
            ) {
              const todayKey = formatDateKey(now);
              setRecords((prev) =>
                prev.map((rec) =>
                  rec.routineId === updated.id &&
                  rec.dateKey === todayKey &&
                  rec.postponedPrimaryTimeHHMM
                    ? resetRoutinePostpone(rec) ?? rec
                    : rec
                )
              );
            }
            // Fuente única de verdad: sincronizar horarios en settings
            if (updated.id === 'pastilla') {
              setSettings((prev) => ({
                ...prev,
                pillMorningTimeHHMM:
                  updated.fixedTimeHHMM ?? prev.pillMorningTimeHHMM,
                pillAfternoonTimeHHMM:
                  updated.secondarySchedule?.timeHHMM ??
                  prev.pillAfternoonTimeHHMM,
              }));
            } else if (updated.id === 'dermastamp') {
              setSettings((prev) => ({
                ...prev,
                dermastampWeekday:
                  updated.weekday ?? prev.dermastampWeekday,
                dermastampTimeHHMM:
                  updated.fixedTimeHHMM ?? prev.dermastampTimeHHMM,
              }));
            }
            showToast(`Rutina "${updated.name}" actualizada.`);
          }}
          onAddRoutine={(newR) => {
            setRoutines((prev) => [...prev, newR]);
            showToast(`Rutina "${newR.name}" añadida.`);
          }}
          onDeleteRoutine={handleDeleteRoutine}
          onAddBlockingRule={(newRule) => {
            setBlockingRules((prev) => [...prev, newRule]);
            showToast('Regla de bloqueo añadida.');
          }}
          onUpdateBlockingRule={(updatedRule) => {
            setBlockingRules((prev) =>
              prev.map((r) => (r.id === updatedRule.id ? updatedRule : r))
            );
            showToast('Regla de bloqueo actualizada.');
          }}
          onDeleteBlockingRule={(ruleId) => {
            setBlockingRules((prev) => prev.filter((r) => r.id !== ruleId));
            showToast('Regla de bloqueo eliminada.');
          }}
        />
      )}

      {activeTab === 'upcoming' && (
        <UpcomingAlarmsScreen
          now={now}
          upcomingOverview={scheduleResult.upcomingSevenDaysOverview}
        />
      )}

      {activeTab === 'history' && (
        <HistoryScreen
          now={now}
          routines={routines}
          records={records}
          blockingRules={blockingRules}
          settings={settings}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsScreen
          now={now}
          settings={settings}
          permissionStatus={permissionStatus}
          permissionDetails={permissionDetails}
          activeScheduledPrompts={scheduleResult.activePromptsToSchedule}
          onUpdateSettings={handleUpdateGlobalSettings}
          onRequestPermissions={async () => {
            const res = await requestNotificationPermissions();
            setPermissionDetails(res.details);
            setPermissionStatus(res.status);
          }}
          onMarkSideloadReinstalled={handleMarkSideloadReinstalled}
        />
      )}

      <div className="tab-bar-dock">
        <nav className="tab-bar-pill" aria-label="Navegación principal">
          <button
            className={`tab-item ${activeTab === 'today' ? 'active' : ''}`}
            onClick={() => setActiveTab('today')}
          >
            <Icon
              name="House"
              size={28}
              weight={activeTab === 'today' ? 'fill' : 'bold'}
            />
            <span>Hoy</span>
          </button>
          <button
            className={`tab-item ${activeTab === 'routines' ? 'active' : ''}`}
            onClick={() => setActiveTab('routines')}
          >
            <Icon
              name="ListChecks"
              size={28}
              weight={activeTab === 'routines' ? 'fill' : 'bold'}
            />
            <span>Rutinas</span>
          </button>
          <button
            className={`tab-item ${activeTab === 'upcoming' ? 'active' : ''}`}
            onClick={() => setActiveTab('upcoming')}
          >
            <Icon
              name="BellRinging"
              size={28}
              weight={activeTab === 'upcoming' ? 'fill' : 'bold'}
            />
            <span>Próximas</span>
          </button>
          <button
            className={`tab-item ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <Icon
              name="CalendarBlank"
              size={28}
              weight={activeTab === 'history' ? 'fill' : 'bold'}
            />
            <span>Historial</span>
          </button>
          <button
            className={`tab-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Icon
              name="GearSix"
              size={28}
              weight={activeTab === 'settings' ? 'fill' : 'bold'}
            />
            <span>Ajustes</span>
          </button>
        </nav>
      </div>
    </div>
  );
};

// @end: Main-App-Container
