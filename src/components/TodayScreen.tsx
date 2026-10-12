// @section: Screen-Today

import React, { useState } from 'react';
import {
  buildDateFromKeyAndHHMM,
  doesRoutineApplyOnDate,
  findActiveBlockForTimestamp,
  formatDateKey,
  resolveRoutinePrimaryDate,
  resolveRoutinePrimaryHHMM,
} from '../core/scheduler';
import type {
  ActiveNoticeMode,
  BlockingRule,
  GlobalSettings,
  RoutineConfig,
  RoutineDayRecord,
} from '../core/types';

interface TodayScreenProps {
  now: Date;
  routines: RoutineConfig[];
  records: RoutineDayRecord[];
  blockingRules: BlockingRule[];
  settings: GlobalSettings;
  effectiveMode: ActiveNoticeMode;
  streakDays: number;
  onMarkDone: (routine: RoutineConfig, dateKey: string) => void;
  onToggleChecklistStep: (
    routine: RoutineConfig,
    dateKey: string,
    stepId: string
  ) => void;
  onPostponeNotAtHome: (routine: RoutineConfig, dateKey: string) => void;
  onActivateDiscreet: (untilDate: Date) => void;
  onActivatePause: (untilDate: Date, targetHHMM: string) => void;
  onResetNoticeMode: () => void;
}

export const TodayScreen: React.FC<TodayScreenProps> = ({
  now,
  routines,
  records,
  blockingRules,
  settings,
  effectiveMode,
  streakDays,
  onMarkDone,
  onToggleChecklistStep,
  onPostponeNotAtHome,
  onActivateDiscreet,
  onActivatePause,
  onResetNoticeMode,
}) => {
  const [customDiscreetHHMM, setCustomDiscreetHHMM] = useState('18:00');
  const [pauseHHMM, setPauseHHMM] = useState('17:00');
  const [showModeModal, setShowModeModal] = useState<'none' | 'discreet' | 'pause'>('none');

  const todayKey = formatDateKey(now);
  const todayRoutines = routines.filter((r) =>
    doesRoutineApplyOnDate(r, todayKey)
  );

  const formatCountdown = (untilISO: string): string => {
    const diffMs = Math.max(0, new Date(untilISO).getTime() - now.getTime());
    const totalSec = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleDiscreetDurationHours = (hours: number) => {
    const until = new Date(now.getTime() + hours * 3600_000);
    onActivateDiscreet(until);
    setShowModeModal('none');
  };

  const handleDiscreetUntilHHMM = () => {
    let target = buildDateFromKeyAndHHMM(todayKey, customDiscreetHHMM);
    if (target.getTime() <= now.getTime()) {
      target = new Date(target.getTime() + 24 * 3600_000);
    }
    onActivateDiscreet(target);
    setShowModeModal('none');
  };

  const handlePauseUntilHHMM = () => {
    let target = buildDateFromKeyAndHHMM(todayKey, pauseHHMM);
    if (target.getTime() <= now.getTime()) {
      target = new Date(target.getTime() + 24 * 3600_000);
    }
    onActivatePause(target, pauseHHMM);
    setShowModeModal('none');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <header className="screen-header">
        <div>
          <h1 className="screen-title">Hoy</h1>
          <p className="routine-subtext">{todayKey}</p>
        </div>
        <div className="streak-pill" title="Días consecutivos cumplidos">
          🔥 {streakDays} {streakDays === 1 ? 'día' : 'días'}
        </div>
      </header>

      {/* Indicador de Modo Activo con cuenta atrás en vivo */}
      {effectiveMode.type !== 'alarm' ? (
        <div className="mode-banner">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <strong style={{ color: 'var(--accent)', fontSize: '1.05rem' }}>
                {effectiveMode.type === 'discreet'
                  ? '🔕 Modo Discreto Activo'
                  : `⏸️ Avisos Pausados hasta ${effectiveMode.targetHHMM}`}
              </strong>
              <p className="routine-subtext" style={{ marginTop: 4 }}>
                Restante:{' '}
                <strong style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                  {formatCountdown(effectiveMode.untilISO)}
                </strong>
              </p>
            </div>
            <button className="chip-btn active" onClick={onResetNoticeMode}>
              Volver a Alarma
            </button>
          </div>
        </div>
      ) : (
        <div className="clock-card" style={{ padding: '16px 18px', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span className="routine-subtext">
              Modo actual: <strong style={{ color: '#fff' }}>🔊 Alarma (AlarmKit)</strong>
            </span>
          </div>
          <div className="mode-controls-row">
            <button
              className={`chip-btn ${showModeModal === 'discreet' ? 'active' : ''}`}
              onClick={() =>
                setShowModeModal(showModeModal === 'discreet' ? 'none' : 'discreet')
              }
            >
              🔕 Modo Discreto…
            </button>
            <button
              className={`chip-btn ${showModeModal === 'pause' ? 'active' : ''}`}
              onClick={() =>
                setShowModeModal(showModeModal === 'pause' ? 'none' : 'pause')
              }
            >
              ⏸️ Pausar hasta HH:MM…
            </button>
          </div>

          {showModeModal === 'discreet' && (
            <div className="checklist-box" style={{ marginTop: 6 }}>
              <span className="routine-subtext">
                Duración obligatoria del Modo Discreto:
              </span>
              <div className="mode-controls-row">
                <button
                  className="chip-btn"
                  onClick={() => handleDiscreetDurationHours(1)}
                >
                  1 h
                </button>
                <button
                  className="chip-btn"
                  onClick={() => handleDiscreetDurationHours(2)}
                >
                  2 h
                </button>
                <button
                  className="chip-btn"
                  onClick={() => handleDiscreetDurationHours(4)}
                >
                  4 h
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <input
                  type="time"
                  className="input-dark"
                  value={customDiscreetHHMM}
                  onChange={(e) => setCustomDiscreetHHMM(e.target.value)}
                />
                <button className="chip-btn active" onClick={handleDiscreetUntilHHMM}>
                  Hasta las {customDiscreetHHMM}
                </button>
              </div>
            </div>
          )}

          {showModeModal === 'pause' && (
            <div className="checklist-box" style={{ marginTop: 6 }}>
              <span className="routine-subtext">
                Silencio total hasta la hora indicada (al terminar, salta 1 única alarma si queda algo sin marcar):
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="time"
                  className="input-dark"
                  value={pauseHHMM}
                  onChange={(e) => setPauseHHMM(e.target.value)}
                />
                <button className="chip-btn active" onClick={handlePauseUntilHHMM}>
                  Pausar hasta {pauseHHMM}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tarjetas grandes de tareas del día */}
      {todayRoutines.map((routine) => {
        const rec = records.find(
          (r) => r.routineId === routine.id && r.dateKey === todayKey
        );
        const primaryHHMM = resolveRoutinePrimaryHHMM(routine, settings);
        const primaryDate = resolveRoutinePrimaryDate(routine, todayKey, settings);
        const blockCheck = findActiveBlockForTimestamp(
          routine.id,
          primaryDate,
          blockingRules,
          records
        );

        const isCompleted = rec?.status === 'completed';
        const isOmitted =
          !isCompleted &&
          (rec?.status === 'omitted_by_block' || blockCheck.blocked);

        const completedSteps = rec?.completedChecklistSteps ?? [];
        const hasChecklist =
          routine.checklistSteps && routine.checklistSteps.length > 0;
        const canCompleteChecklist =
          !hasChecklist ||
          routine.checklistSteps!.every((s, idx) =>
            idx === routine.checklistSteps!.length - 1
              ? true
              : completedSteps.includes(s.id)
          );

        const afternoonHHMM =
          rec?.postponedAfternoonTimeHHMM ??
          routine.secondarySchedule?.timeHHMM;

        return (
          <div
            key={routine.id}
            className={`clock-card ${isCompleted ? 'completed' : ''} ${
              isOmitted ? 'omitted' : ''
            }`}
          >
            <div className="clock-card-top">
              <div>
                <div className="time-huge">{primaryHHMM}</div>
                <div className="routine-label">{routine.name}</div>
                {routine.secondarySchedule && (
                  <div className="routine-subtext">
                    2º aviso tarde: <strong>{afternoonHHMM}</strong>
                    {rec?.notAtHomePostponeCount
                      ? ` (pospuesto ${rec.notAtHomePostponeCount}x)`
                      : ''}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <span className="badge-muted">
                  {routine.allowDiscreetMode ? 'Permite discreto' : 'Siempre alarma'}
                </span>
                {isCompleted && (
                  <span className="badge-accent">✓ Hecho</span>
                )}
                {isOmitted && (
                  <span className="badge-accent">
                    🛡️ {blockCheck.rule?.statusLabel ?? rec?.blockReason ?? 'Omitido por dermastamp'}
                  </span>
                )}
              </div>
            </div>

            {/* Checklist de 2 pasos (ej. Dermastamp) */}
            {hasChecklist && !isCompleted && !isOmitted && (
              <div className="checklist-box">
                <span className="routine-subtext">
                  Completa en orden los 2 pasos:
                </span>
                {routine.checklistSteps!.map((step, idx) => {
                  const done = completedSteps.includes(step.id);
                  const prevDone =
                    idx === 0 ||
                    completedSteps.includes(routine.checklistSteps![idx - 1].id);
                  return (
                    <button
                      key={step.id}
                      disabled={!prevDone && !done}
                      className={`checklist-step ${done ? 'active-step' : ''}`}
                      onClick={() =>
                        onToggleChecklistStep(routine, todayKey, step.id)
                      }
                    >
                      <span
                        style={{
                          color: done ? 'var(--accent)' : 'var(--text-secondary)',
                          fontWeight: 700,
                        }}
                      >
                        {done ? '☑' : `${idx + 1}.`}
                      </span>
                      <span>{step.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Botones de acción enormes */}
            {!isCompleted && !isOmitted && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  className="btn-done-huge"
                  disabled={!canCompleteChecklist}
                  onClick={() => onMarkDone(routine, todayKey)}
                >
                  ✓ Hecho
                </button>

                {routine.secondarySchedule?.allowNotAtHomePostpone && (
                  <button
                    className="btn-secondary-action"
                    disabled={afternoonHHMM === routine.secondarySchedule.maxPostponeTimeHHMM}
                    onClick={() => onPostponeNotAtHome(routine, todayKey)}
                  >
                    {afternoonHHMM === routine.secondarySchedule.maxPostponeTimeHHMM
                      ? 'Límite de posposición alcanzado (22:00)'
                      : `No estoy en casa (+1h → máx. ${routine.secondarySchedule.maxPostponeTimeHHMM})`}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// @end: Screen-Today
