// @section: Screen-Today

import React, { useEffect, useState } from 'react';
import {
  addDaysToDateKey,
  buildDateFromKeyAndHHMM,
  computeDueProgressForDay,
  computeWeeklyCompliancePercentage,
  doesRoutineApplyOnDate,
  evaluateDaySummary,
  findActiveBlockForTimestamp,
  formatDateKey,
  formatRelativeDateLabel,
  getWeekdayFromDateKey,
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
import { BottomSheet, SegmentedControl, TimePickerSheet } from './CustomControls';
import { Icon } from './Icon';
import { getRoutineVisualMeta } from './routineTheme';

interface TodayScreenProps {
  now: Date;
  routines: RoutineConfig[];
  records: RoutineDayRecord[];
  blockingRules: BlockingRule[];
  settings: GlobalSettings;
  effectiveMode: ActiveNoticeMode;
  streakDays: number;
  onMarkDone: (routine: RoutineConfig, dateKey: string) => void;
  onUndoDone: (routine: RoutineConfig, dateKey: string) => void;
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

type ModeSelection = 'alarm' | 'discreet' | 'paused';
type DiscreetPreset = '1h' | '2h' | '4h' | 'custom';

const SHORT_WEEKDAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export const TodayScreen: React.FC<TodayScreenProps> = ({
  now,
  routines,
  records,
  blockingRules,
  settings,
  effectiveMode,
  streakDays,
  onMarkDone,
  onUndoDone,
  onToggleChecklistStep,
  onPostponeNotAtHome,
  onActivateDiscreet,
  onActivatePause,
  onResetNoticeMode,
}) => {
  const todayKey = formatDateKey(now);
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayKey);
  const [showDayStrip, setShowDayStrip] = useState<boolean>(false);
  const [showModeCardDrawer, setShowModeCardDrawer] = useState<boolean>(false);
  const [pendingModeTab, setPendingModeTab] = useState<ModeSelection | null>(
    null
  );
  const [mountedAnim, setMountedAnim] = useState(false);
  const [confirmUndoTarget, setConfirmUndoTarget] = useState<{
    routine: RoutineConfig;
    dateKey: string;
  } | null>(null);

  const [timeSheetConfig, setTimeSheetConfig] = useState<{
    open: boolean;
    mode: 'discreet' | 'paused';
    initialHHMM: string;
  }>({
    open: false,
    mode: 'paused',
    initialHHMM: '18:00',
  });

  useEffect(() => {
    const t = requestAnimationFrame(() => setMountedAnim(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const sevenDayStripKeys = [-3, -2, -1, 0, 1, 2, 3].map((offset) =>
    addDaysToDateKey(todayKey, offset)
  );

  const selectedDayRoutines = routines.filter((r) =>
    doesRoutineApplyOnDate(r, selectedDateKey)
  );

  const dueProgress = computeDueProgressForDay(
    now,
    routines,
    records,
    blockingRules,
    settings
  );

  const weeklyCompliance = computeWeeklyCompliancePercentage(
    now,
    routines,
    records,
    blockingRules,
    settings
  );

  const selectedDateObj = buildDateFromKeyAndHHMM(selectedDateKey, '12:00');
  const dayAndMonth = selectedDateObj.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
  });
  const headerTitle =
    selectedDateKey === todayKey
      ? `Hoy, ${dayAndMonth}`
      : selectedDateObj.toLocaleDateString('es-ES', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });

  const formatCountdown = (untilISO: string): string => {
    const diffMs = Math.max(0, new Date(untilISO).getTime() - now.getTime());
    const totalSec = Math.floor(diffMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(
      s
    ).padStart(2, '0')}`;
  };

  // Geometría del Anillo Hero principal (diámetro 192, trazo 27 = 14% del diámetro)
  const heroSize = 192;
  const heroStroke = 27;
  const heroRadius = (heroSize - heroStroke) / 2;
  const heroCirc = 2 * Math.PI * heroRadius;
  const heroRatio = mountedAnim ? dueProgress.percentage / 100 : 0;
  const heroDashoffset = heroCirc * (1 - heroRatio);

  const totalApplicableToday =
    dueProgress.totalDueCount + dueProgress.upcomingFutureCount;
  const hatchedPendingRatio =
    totalApplicableToday > 0
      ? dueProgress.upcomingFutureCount / totalApplicableToday
      : 0.25;
  const hatchedDasharray = `${heroCirc * hatchedPendingRatio} ${heroCirc}`;

  const miniSize = 84;
  const miniStroke = 11;
  const miniRadius = (miniSize - miniStroke) / 2;
  const miniCirc = 2 * Math.PI * miniRadius;

  const miniRingsData = [
    {
      id: 'hoy',
      label: 'Hoy',
      centerText: `${dueProgress.completedDueCount}/${dueProgress.totalDueCount}`,
      ratio: mountedAnim ? dueProgress.percentage / 100 : 0,
      gradId: 'gradMiniHoy',
      c1: '#5a9bfe',
      c2: '#27d3af',
    },
    {
      id: 'racha',
      label: 'Racha',
      centerText: `${streakDays}d`,
      ratio: mountedAnim ? Math.min(1, Math.max(0.12, streakDays / 7)) : 0,
      gradId: 'gradMiniRacha',
      c1: '#fbbf24',
      c2: '#f59e0b',
    },
    {
      id: 'semana',
      label: 'Semana',
      centerText: `${weeklyCompliance.percentage}%`,
      ratio: mountedAnim ? weeklyCompliance.percentage / 100 : 0,
      gradId: 'gradMiniSemana',
      c1: '#b392f0',
      c2: '#7c3aed',
    },
  ];

  const activeModeTab: ModeSelection = pendingModeTab ?? effectiveMode.type;

  const handleModeSegmentChange = (next: ModeSelection) => {
    if (next === 'alarm') {
      setPendingModeTab(null);
      onResetNoticeMode();
      return;
    }
    if (next === 'paused') {
      setPendingModeTab('paused');
      setTimeSheetConfig({
        open: true,
        mode: 'paused',
        initialHHMM: '18:00',
      });
      return;
    }
    setPendingModeTab('discreet');
  };

  const handleDiscreetPresetSelect = (preset: DiscreetPreset) => {
    if (preset === 'custom') {
      setTimeSheetConfig({
        open: true,
        mode: 'discreet',
        initialHHMM: '19:00',
      });
      return;
    }
    const hours = preset === '1h' ? 1 : preset === '2h' ? 2 : 4;
    const until = new Date(now.getTime() + hours * 3600_000);
    onActivateDiscreet(until);
    setPendingModeTab(null);
  };

  const handleConfirmTimeSheet = (hhmm: string) => {
    let target = buildDateFromKeyAndHHMM(todayKey, hhmm);
    if (target.getTime() <= now.getTime()) {
      target = new Date(target.getTime() + 24 * 3600_000);
    }
    if (timeSheetConfig.mode === 'discreet') {
      onActivateDiscreet(target);
    } else {
      onActivatePause(target, hhmm);
    }
    setPendingModeTab(null);
  };

  return (
    <div className="bevel-today">
      {/* Título de pantalla 34px/700 desplegable para selector de 7 días */}
      <div className="bevel-screen-title-row">
        <button
          type="button"
          className="bevel-screen-title-btn"
          onClick={() => setShowDayStrip((v) => !v)}
          aria-expanded={showDayStrip}
          title="Alternar selector de días de la semana"
        >
          <h1 className="bevel-main-title">{headerTitle}</h1>
          <Icon
            name="CaretDown"
            size={20}
            weight="bold"
            color="var(--text-secondary)"
          />
        </button>

        {selectedDateKey !== todayKey && (
          <button
            type="button"
            className="time-trigger-pill"
            style={{ minHeight: '36px', padding: '0 14px', fontSize: '14px' }}
            onClick={() => setSelectedDateKey(todayKey)}
          >
            <span>Volver a hoy</span>
          </button>
        )}
      </div>

      {/* Chips de estado: icono relleno de 22px dentro de círculo con degradado (SpeakerHigh, BellSlash, Pause, Flame) */}
      <div className="bevel-status-chips-row">
        <button
          type="button"
          className="bevel-status-chip"
          onClick={() => setShowModeCardDrawer((v) => !v)}
        >
          <div className="chip-left-group">
            <div
              className={`chip-gradient-orb ${
                effectiveMode.type === 'discreet'
                  ? 'blue-orb'
                  : effectiveMode.type === 'paused'
                  ? 'amber-orb'
                  : ''
              }`}
            >
              {effectiveMode.type === 'discreet' ? (
                <Icon name="BellSlash" size={22} weight="fill" color="#ffffff" />
              ) : effectiveMode.type === 'paused' ? (
                <Icon name="Pause" size={22} weight="fill" color="#ffffff" />
              ) : (
                <Icon
                  name="SpeakerHigh"
                  size={22}
                  weight="fill"
                  color="#ffffff"
                />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="chip-title-text">
                {effectiveMode.type === 'discreet'
                  ? 'Discreto'
                  : effectiveMode.type === 'paused'
                  ? 'En pausa'
                  : 'Modo Alarma'}
              </div>
              <div className="chip-sub-text">
                {effectiveMode.type !== 'alarm'
                  ? formatCountdown(effectiveMode.untilISO)
                  : 'Hasta un cambio'}
              </div>
            </div>
          </div>
          <Icon
            name="CaretDown"
            size={16}
            weight="bold"
            color="var(--text-secondary)"
          />
        </button>

        <div className="bevel-status-chip is-static">
          <div className="chip-left-group">
            <div className="chip-gradient-orb amber-orb">
              <Icon name="Flame" size={22} weight="fill" color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="chip-title-text">
                {streakDays} {streakDays === 1 ? 'día' : 'días'}
              </div>
              <div className="chip-sub-text">Racha activa</div>
            </div>
          </div>
        </div>
      </div>

      {/* Panel desplegable de Modo con Control Segmentado deslizante */}
      {showModeCardDrawer && (
        <section className="clock-card" style={{ padding: '18px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div className="routine-label" style={{ fontSize: '18px' }}>
                Modo de aviso
              </div>
              <div className="routine-subtext" style={{ fontSize: '14px' }}>
                {effectiveMode.type === 'discreet'
                  ? 'Vibración y notificaciones locales sin AlarmKit'
                  : effectiveMode.type === 'paused'
                  ? `Silencio total hasta las ${effectiveMode.targetHHMM}`
                  : 'AlarmKit activo (suena incluso en modo silencio)'}
              </div>
            </div>
          </div>

          <SegmentedControl<ModeSelection>
            options={[
              { value: 'alarm', label: 'Alarma' },
              { value: 'discreet', label: 'Discreto' },
              { value: 'paused', label: 'Pausar' },
            ]}
            value={activeModeTab}
            onChange={handleModeSegmentChange}
          />

          {activeModeTab === 'discreet' && effectiveMode.type !== 'discreet' && (
            <SegmentedControl<DiscreetPreset>
              options={[
                { value: '1h', label: '1 h' },
                { value: '2h', label: '2 h' },
                { value: '4h', label: '4 h' },
                { value: 'custom', label: 'Hora…' },
              ]}
              value="1h"
              onChange={handleDiscreetPresetSelect}
            />
          )}
        </section>
      )}

      {/* Tira de 7 días desplegable al pulsar el icono de calendario o la fecha */}
      {showDayStrip && (
        <section
          className="day-strip-grid"
          aria-label="Selector de días de la semana"
        >
          {sevenDayStripKeys.map((dKey) => {
            const weekdayIdx = getWeekdayFromDateKey(dKey);
            const dayNum = Number(dKey.split('-')[2]);
            const isSelected = dKey === selectedDateKey;
            const isFuture = dKey > todayKey;
            const summary = evaluateDaySummary(
              dKey,
              todayKey,
              routines,
              records,
              blockingRules,
              settings
            );
            const isCompletedDay =
              summary.overallStatus === 'completed' ||
              summary.overallStatus === 'omitted_by_block';

            return (
              <button
                key={dKey}
                type="button"
                className={`day-tall-pill ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelectedDateKey(dKey)}
              >
                <span className="day-pill-letter">
                  {SHORT_WEEKDAYS[weekdayIdx]}
                </span>
                <span className="day-pill-num">{dayNum}</span>
                <div
                  className={`day-pill-status-circle ${
                    isCompletedDay
                      ? 'completed'
                      : isFuture
                      ? 'future-dashed'
                      : 'past-ring'
                  }`}
                >
                  {isCompletedDay ? (
                    <Icon name="Check" size={14} weight="bold" />
                  ) : (
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>
                      {summary.routineStatuses.filter(
                        (s) => s.status === 'completed'
                      ).length || ''}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </section>
      )}

      {/* Tarjeta Hero de Anillos */}
      <section className="bevel-hero-rings-card" aria-label="Anillos de cumplimiento">
        <div className="hero-main-ring-wrap">
          <svg
            width={heroSize}
            height={heroSize}
            viewBox={`0 0 ${heroSize} ${heroSize}`}
            style={{ transform: 'rotate(-90deg)' }}
          >
            <defs>
              <pattern
                id="bevelHatchPattern"
                width="7"
                height="7"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="7" height="7" fill="rgba(154, 127, 89, 0.25)" />
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="7"
                  stroke="#d0b778"
                  strokeWidth="2.4"
                  strokeOpacity="0.65"
                />
              </pattern>

              <linearGradient id="heroMainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fee58a" />
                <stop offset="45%" stopColor="#27d3af" />
                <stop offset="100%" stopColor="#0fa88a" />
              </linearGradient>
            </defs>

            <circle
              cx={heroSize / 2}
              cy={heroSize / 2}
              r={heroRadius}
              fill="none"
              stroke="var(--ring-track-bg)"
              strokeWidth={heroStroke}
            />

            {dueProgress.upcomingFutureCount > 0 && (
              <circle
                cx={heroSize / 2}
                cy={heroSize / 2}
                r={heroRadius}
                fill="none"
                stroke="url(#bevelHatchPattern)"
                strokeWidth={heroStroke - 4}
                strokeDasharray={hatchedDasharray}
                strokeDashoffset={-heroCirc * 0.15}
                strokeLinecap="round"
              />
            )}

            <circle
              cx={heroSize / 2}
              cy={heroSize / 2}
              r={heroRadius}
              fill="none"
              stroke="url(#heroMainGrad)"
              strokeWidth={heroStroke - 4}
              strokeLinecap="round"
              strokeDasharray={heroCirc}
              strokeDashoffset={heroDashoffset}
              style={{
                transition: 'stroke-dashoffset 0.7s var(--ease-out)',
              }}
            />

            <circle
              cx={heroSize - heroStroke / 2}
              cy={heroSize / 2}
              r={5.5}
              fill="var(--ring-dot-yellow)"
            />
          </svg>

          <div className="hero-sunken-well">
            <div className="hero-big-digits">
              {dueProgress.percentage}
              <span className="pct-unit">%</span>
            </div>
            <div className="hero-well-sub">Vencidas</div>
          </div>
        </div>

        <div className="three-mini-rings-row">
          {miniRingsData.map((item, idx) => {
            const offset = miniCirc * (1 - item.ratio);
            return (
              <React.Fragment key={item.id}>
                {idx > 0 && <div className="vertical-ring-divider" />}
                <div className="mini-ring-col">
                  <div className="mini-ring-box">
                    <svg
                      width={miniSize}
                      height={miniSize}
                      viewBox={`0 0 ${miniSize} ${miniSize}`}
                      style={{ transform: 'rotate(-90deg)' }}
                    >
                      <defs>
                        <linearGradient
                          id={item.gradId}
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="100%"
                        >
                          <stop offset="0%" stopColor={item.c1} />
                          <stop offset="100%" stopColor={item.c2} />
                        </linearGradient>
                      </defs>
                      <circle
                        cx={miniSize / 2}
                        cy={miniSize / 2}
                        r={miniRadius}
                        fill="none"
                        stroke="var(--ring-track-bg)"
                        strokeWidth={miniStroke}
                      />
                      <circle
                        cx={miniSize / 2}
                        cy={miniSize / 2}
                        r={miniRadius}
                        fill="none"
                        stroke={`url(#${item.gradId})`}
                        strokeWidth={miniStroke - 2}
                        strokeLinecap="round"
                        strokeDasharray={miniCirc}
                        strokeDashoffset={offset}
                        style={{
                          transition: 'stroke-dashoffset 0.7s var(--ease-out)',
                        }}
                      />
                    </svg>
                    <div className="mini-sunken-well">{item.centerText}</div>
                  </div>
                  <span className="mini-ring-label">{item.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {/* Tarjeta contextual: bloqueo activo del minoxidil con cuenta atrás, o el próximo dermastamp si no hay bloqueo */}
      {(() => {
        const nowMs = now.getTime();
        let activeMinoxidilBlock: {
          untilISO: string;
          sourceName: string;
        } | null = null;

        for (const rule of blockingRules) {
          if (rule.targetRoutineId !== 'minoxidil') continue;
          const durationMs = rule.blockDurationHours * 3600_000;
          for (const rec of records) {
            if (
              rec.routineId === rule.sourceRoutineId &&
              rec.status === 'completed' &&
              rec.completedAtISO
            ) {
              const startMs = new Date(rec.completedAtISO).getTime();
              const endMs = startMs + durationMs;
              if (nowMs >= startMs && nowMs < endMs) {
                const srcRoutine = routines.find(
                  (r) => r.id === rule.sourceRoutineId
                );
                activeMinoxidilBlock = {
                  untilISO: new Date(endMs).toISOString(),
                  sourceName: srcRoutine?.name ?? 'Dermastamp',
                };
              }
            }
          }
        }

        const dermastampRoutine = routines.find((r) => r.id === 'dermastamp');
        const dermaTheme = getRoutineVisualMeta('dermastamp');

        if (activeMinoxidilBlock) {
          return (
            <section
              className="bevel-contextual-card is-active-block"
              aria-label="Bloqueo activo de Minoxidil"
            >
              <div className="bevel-row-left">
                <div
                  className="chip-gradient-orb"
                  style={{
                    background: dermaTheme.orbGradient,
                    boxShadow: dermaTheme.orbShadow,
                  }}
                >
                  <Icon
                    name="ShieldCheck"
                    size={22}
                    weight="fill"
                    color="#ffffff"
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    className="bevel-routine-name"
                    style={{ fontSize: '17px' }}
                  >
                    Minoxidil bloqueado
                  </div>
                  <div
                    className="bevel-routine-sub"
                    style={{ marginTop: '2px', fontSize: '14px' }}
                  >
                    Por {activeMinoxidilBlock.sourceName} (24 h)
                  </div>
                </div>
              </div>
              <span className="contextual-countdown-pill">
                {formatCountdown(activeMinoxidilBlock.untilISO)}
              </span>
            </section>
          );
        }

        if (!dermastampRoutine || !dermastampRoutine.enabled) return null;

        let nextDermaDateKey = todayKey;
        for (let offset = 0; offset <= 7; offset++) {
          const candidateKey = addDaysToDateKey(todayKey, offset);
          if (!doesRoutineApplyOnDate(dermastampRoutine, candidateKey)) continue;
          const candidateRec = records.find(
            (r) =>
              r.routineId === dermastampRoutine.id && r.dateKey === candidateKey
          );
          if (candidateRec?.status === 'completed') continue;
          nextDermaDateKey = candidateKey;
          break;
        }

        const dermaHHMM = resolveRoutinePrimaryHHMM(
          dermastampRoutine,
          settings
        );

        return (
          <section
            className="bevel-contextual-card"
            aria-label="Próximo Dermastamp"
          >
            <div className="bevel-row-left">
              <div
                className="chip-gradient-orb"
                style={{
                  background: dermaTheme.orbGradient,
                  boxShadow: dermaTheme.orbShadow,
                }}
              >
                <Icon name="Stamp" size={22} weight="fill" color="#ffffff" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  className="bevel-routine-name"
                  style={{ fontSize: '17px' }}
                >
                  Próximo Dermastamp
                </div>
                <div
                  className="bevel-routine-sub"
                  style={{ marginTop: '2px', fontSize: '14px' }}
                >
                  Bloquea Minoxidil durante 24 h al marcar
                </div>
              </div>
            </div>
            <span className="contextual-date-pill">
              {formatRelativeDateLabel(nextDermaDateKey, todayKey)} · {dermaHHMM}
            </span>
          </section>
        );
      })()}

      {/* Sección de Rutinas del día seleccionado */}
      <div className="bevel-section-header">
        <h2 className="bevel-section-title">
          {selectedDateKey === todayKey
            ? 'Tareas de hoy'
            : `Tareas · ${formatRelativeDateLabel(selectedDateKey, todayKey)}`}
        </h2>
      </div>

      {selectedDayRoutines.length === 0 ? (
        <div className="bevel-empty-dashed-box">
          <Icon name="CheckCircle" size={26} weight="fill" />
          <span>Día sin rutinas programadas</span>
        </div>
      ) : (
        <div className="bevel-routine-cards-stack">
          {selectedDayRoutines.map((routine) => {
            const visual = getRoutineVisualMeta(routine.id);

            const rec = records.find(
              (r) =>
                r.routineId === routine.id && r.dateKey === selectedDateKey
            );
            const primaryHHMM = resolveRoutinePrimaryHHMM(routine, settings);
            const primaryDate = resolveRoutinePrimaryDate(
              routine,
              selectedDateKey,
              settings
            );
            const blockCheck = findActiveBlockForTimestamp(
              routine.id,
              primaryDate,
              blockingRules,
              records
            );

            const isCompleted = rec?.status === 'completed';
            const isStaleBlock =
              rec?.status === 'omitted_by_block' &&
              rec.blockedByRoutineId &&
              routines.some((rt) => rt.id === rec.blockedByRoutineId) &&
              !blockCheck.blocked;
            const isOmitted =
              !isCompleted &&
              ((rec?.status === 'omitted_by_block' && !isStaleBlock) ||
                blockCheck.blocked);
            const isDue = primaryDate.getTime() <= now.getTime();

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
              <article
                key={routine.id}
                role={isCompleted ? 'button' : undefined}
                tabIndex={isCompleted ? 0 : undefined}
                onClick={
                  isCompleted
                    ? () =>
                        setConfirmUndoTarget({
                          routine,
                          dateKey: selectedDateKey,
                        })
                    : undefined
                }
                onKeyDown={
                  isCompleted
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setConfirmUndoTarget({
                            routine,
                            dateKey: selectedDateKey,
                          });
                        }
                      }
                    : undefined
                }
                className={`bevel-routine-row-card ${
                  isCompleted || isOmitted ? 'is-resolved' : ''
                } ${isCompleted ? 'interactive-row' : ''}`}
              >
                <div className="bevel-row-top">
                  <div className="bevel-row-left">
                    {/* Círculo de 54px con degradado propio de la rutina (más claro arriba a más oscuro abajo), sin borde de contorno, e icono blanco fill de 26px */}
                    <div
                      className="bevel-routine-orb"
                      style={{
                        background: visual.orbGradient,
                        boxShadow: visual.orbShadow,
                      }}
                    >
                      <Icon
                        name={visual.iconName}
                        size={26}
                        weight="fill"
                        color="#f8fafc"
                      />
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div className="bevel-routine-name">{routine.name}</div>
                      <div className="bevel-routine-sub">
                        <strong
                          style={{
                            color: 'var(--text-primary)',
                            fontWeight: 600,
                          }}
                        >
                          {primaryHHMM}
                        </strong>
                        {' · '}
                        {isCompleted && 'Completada · Toca para deshacer'}
                        {isOmitted &&
                          (blockCheck.rule?.statusLabel ??
                            rec?.blockReason ??
                            'Omitido por dermastamp')}
                        {!isCompleted && !isOmitted && (
                          <>
                            {isDue ? 'Vencida' : 'Programada'}
                            {routine.secondarySchedule
                              ? ` · Tarde ${afternoonHHMM}`
                              : ''}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Botón "Hecho" con Check weight="bold" o botón de deshacer si está completada */}
                  {!isCompleted && !isOmitted ? (
                    <button
                      type="button"
                      className="bevel-row-action-pill done-active"
                      disabled={!canCompleteChecklist}
                      onClick={() => onMarkDone(routine, selectedDateKey)}
                    >
                      <Icon
                        name="Check"
                        size={18}
                        weight="bold"
                        color="#27d3af"
                      />
                      <span>Hecho</span>
                    </button>
                  ) : isCompleted ? (
                    <button
                      type="button"
                      className="bevel-row-action-pill"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmUndoTarget({
                          routine,
                          dateKey: selectedDateKey,
                        });
                      }}
                    >
                      <Icon
                        name="Check"
                        size={18}
                        weight="bold"
                        color={visual.colorVar}
                      />
                      <span>Hecho</span>
                    </button>
                  ) : (
                    <div className="bevel-row-action-pill">
                      <Icon
                        name="ShieldCheck"
                        size={18}
                        weight="bold"
                        color={visual.colorVar}
                      />
                      <span>Omitido</span>
                    </div>
                  )}
                </div>

                {/* Checklist de 2 pasos del Dermastamp */}
                {hasChecklist && !isCompleted && !isOmitted && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      paddingTop: 4,
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    {routine.checklistSteps!.map((step, idx) => {
                      const done = completedSteps.includes(step.id);
                      const prevDone =
                        idx === 0 ||
                        completedSteps.includes(
                          routine.checklistSteps![idx - 1].id
                        );
                      return (
                        <button
                          key={step.id}
                          type="button"
                          disabled={!prevDone && !done}
                          className="bevel-row-action-pill"
                          style={{
                            width: '100%',
                            justifyContent: 'flex-start',
                            padding: '10px 14px',
                          }}
                          onClick={() =>
                            onToggleChecklistStep(
                              routine,
                              selectedDateKey,
                              step.id
                            )
                          }
                        >
                          {done ? (
                            <Icon
                              name="CheckCircle"
                              size={20}
                              weight="fill"
                              color={visual.colorVar}
                            />
                          ) : (
                            <Icon
                              name="Circle"
                              size={20}
                              weight="bold"
                              color="var(--text-secondary)"
                            />
                          )}
                          <span>
                            {idx + 1}. {step.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Botón secundario "No estoy en casa" en la Pastilla */}
                {!isCompleted &&
                  !isOmitted &&
                  routine.secondarySchedule?.allowNotAtHomePostpone && (
                    <button
                      type="button"
                      className="bevel-row-action-pill"
                      style={{ width: '100%' }}
                      disabled={
                        afternoonHHMM ===
                        routine.secondarySchedule.maxPostponeTimeHHMM
                      }
                      onClick={() =>
                        onPostponeNotAtHome(routine, selectedDateKey)
                      }
                    >
                      <Icon
                        name="House"
                        size={18}
                        weight="bold"
                        color="var(--text-secondary)"
                      />
                      <span>
                        {afternoonHHMM ===
                        routine.secondarySchedule.maxPostponeTimeHHMM
                          ? 'Límite de las 22:00 alcanzado'
                          : `No estoy en casa (+1h → ${afternoonHHMM})`}
                      </span>
                    </button>
                  )}
              </article>
            );
          })}
        </div>
      )}

      {/* Hoja de confirmación para desmarcar tarea completada */}
      <BottomSheet
        open={Boolean(confirmUndoTarget)}
        title={
          confirmUndoTarget
            ? `¿Desmarcar ${confirmUndoTarget.routine.name}?`
            : '¿Desmarcar tarea?'
        }
        subtitle={
          confirmUndoTarget &&
          blockingRules.some(
            (r) => r.sourceRoutineId === confirmUndoTarget.routine.id
          )
            ? 'La tarea volverá a estar pendiente, se reprogramarán sus alarmas, se anulará el bloqueo de 24 h (los Minoxidil omitidos volverán a estar pendientes) y se recalcularán racha y porcentajes.'
            : confirmUndoTarget?.routine.secondarySchedule
            ? 'La tarea volverá a estar pendiente, se reprogramarán sus alarmas (incluyendo el aviso de la tarde) y se recalcularán racha y porcentajes.'
            : 'La tarea volverá a estar pendiente, se reprogramarán sus alarmas e insistencias y se recalcularán racha y porcentajes.'
        }
        onClose={() => setConfirmUndoTarget(null)}
      >
        {confirmUndoTarget && (
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              className="bevel-row-action-pill"
              style={{ flex: 1 }}
              onClick={() => setConfirmUndoTarget(null)}
            >
              <span>Cancelar</span>
            </button>
            <button
              type="button"
              className="danger-action-btn"
              style={{ flex: 1 }}
              onClick={() => {
                onUndoDone(
                  confirmUndoTarget.routine,
                  confirmUndoTarget.dateKey
                );
                setConfirmUndoTarget(null);
              }}
            >
              <Icon
                name="ClockCounterClockwise"
                size={18}
                weight="bold"
                color="#f87171"
              />
              <span>Deshacer tarea</span>
            </button>
          </div>
        )}
      </BottomSheet>

      <TimePickerSheet
        open={timeSheetConfig.open}
        title={
          timeSheetConfig.mode === 'discreet'
            ? 'Modo Discreto hasta una hora'
            : 'Pausar avisos hasta'
        }
        subtitle={
          timeSheetConfig.mode === 'discreet'
            ? 'Las alarmas se sustituirán por notificaciones discretas hasta esta hora.'
            : 'Silencio total. Al terminar sonará una única alarma si queda algo pendiente.'
        }
        initialHHMM={timeSheetConfig.initialHHMM}
        confirmLabel={
          timeSheetConfig.mode === 'discreet'
            ? 'Activar Modo Discreto'
            : 'Pausar avisos'
        }
        onConfirm={handleConfirmTimeSheet}
        onClose={() => {
          setTimeSheetConfig((prev) => ({ ...prev, open: false }));
          setPendingModeTab(null);
        }}
      />
    </div>
  );
};

// @end: Screen-Today
