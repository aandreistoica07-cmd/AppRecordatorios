// @section: Main-App-Container

import React, { useEffect, useState } from 'react';
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
  evaluateDaySummary,
  formatDateKey,
  markRoutineDone,
  postponeRoutineNotAtHome,
  toggleChecklistStep,
} from './core/scheduler';
import type {
  ActiveNoticeMode,
  BlockingRule,
  GlobalSettings,
  RoutineConfig,
  RoutineDayRecord,
} from './core/types';
import {
  configureNativeStatusBar,
  triggerLightHaptic,
  triggerSuccessHaptic,
} from './services/deviceBridge';
import {
  registerNotificationCategories,
  requestNotificationPermissions,
  syncSystemNotifications,
} from './services/notificationAdapter';
import { loadAppState, saveAppState } from './services/storage';

type TabKey = 'today' | 'routines' | 'upcoming' | 'history' | 'settings';

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
  const [permissionStatus, setPermissionStatus] = useState<string>('Pendiente');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [externalModeSheetOpen, setExternalModeSheetOpen] =
    useState<boolean>(false);

  // Cargar datos de @capacitor/preferences y configurar StatusBar al abrir la app
  useEffect(() => {
    let mounted = true;
    (async () => {
      await configureNativeStatusBar();
      await registerNotificationCategories();
      const loaded = await loadAppState();
      if (!mounted) return;
      setSettings(loaded.settings);
      setRoutines(loaded.routines);
      setBlockingRules(loaded.blockingRules);
      setRecords(loaded.records);
      setNoticeMode(loaded.noticeMode);
      setHydrated(true);
    })();
    return () => {
      mounted = false;
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

  // Guardar y reprogramar avisos tras cada acción o cambio de ajustes/modo
  useEffect(() => {
    if (!hydrated) return;

    // Persistir automáticamente registros 'omitted_by_block' generados dentro de las 24h del dermastamp
    let updatedRecords = records;
    if (scheduleResult.autoOmittedRecords.length > 0) {
      let changed = false;
      const copy = [...records];
      for (const autoRec of scheduleResult.autoOmittedRecords) {
        const idx = copy.findIndex(
          (r) =>
            r.routineId === autoRec.routineId && r.dateKey === autoRec.dateKey
        );
        if (idx === -1) {
          copy.push(autoRec);
          changed = true;
        } else if (copy[idx].status !== 'omitted_by_block' && copy[idx].status !== 'completed') {
          copy[idx] = autoRec;
          changed = true;
        }
      }
      if (changed) {
        updatedRecords = copy;
        setRecords(copy);
      }
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

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const upsertRecordAndCheckCompletion = (
    nextRecord: RoutineDayRecord,
    dateKey: string
  ) => {
    const idx = records.findIndex(
      (r) =>
        r.routineId === nextRecord.routineId &&
        r.dateKey === nextRecord.dateKey
    );
    const nextRecords =
      idx === -1
        ? [...records, nextRecord]
        : records.map((r, i) => (i === idx ? nextRecord : r));

    setRecords(nextRecords);

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
    upsertRecordAndCheckCompletion(res.record, dateKey);
    showToast(`✓ ${routine.name} marcado como Hecho. Alarmas del día canceladas.`);
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
    upsertRecordAndCheckCompletion(res.record, dateKey);
    if (res.record.status === 'completed') {
      showToast(
        `✓ ${routine.name} completado. Bloqueo de 24h activado para tareas dependientes.`
      );
    }
  };

  const handlePostponeNotAtHome = (routine: RoutineConfig, dateKey: string) => {
    const existing = records.find(
      (r) => r.routineId === routine.id && r.dateKey === dateKey
    );
    const res = postponeRoutineNotAtHome(routine, existing, dateKey, new Date());
    void triggerLightHaptic();
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
    showToast('Ajustes actualizados y alarmas de 7 días reprogramadas.');
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
          streakDays={streakDays}
          externalModeSheetOpen={externalModeSheetOpen}
          onCloseExternalModeSheet={() => setExternalModeSheetOpen(false)}
          onOpenSettingsTab={() => setActiveTab('settings')}
          onMarkDone={handleMarkDone}
          onToggleChecklistStep={handleToggleChecklistStep}
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
            setRoutines((prev) =>
              prev.map((r) => (r.id === updated.id ? updated : r))
            );
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
          onOpenSettingsTab={() => setActiveTab('settings')}
        />
      )}

      {activeTab === 'history' && (
        <HistoryScreen
          now={now}
          routines={routines}
          records={records}
          blockingRules={blockingRules}
          settings={settings}
          onOpenSettingsTab={() => setActiveTab('settings')}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsScreen
          settings={settings}
          permissionStatus={permissionStatus}
          activeScheduledPrompts={scheduleResult.activePromptsToSchedule}
          onUpdateSettings={handleUpdateGlobalSettings}
          onRequestPermissions={async () => {
            const res = await requestNotificationPermissions();
            setPermissionStatus(
              res.granted ? 'Concedido' : `Denegado`
            );
          }}
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
