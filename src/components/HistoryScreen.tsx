// @section: History-And-Calendar-Screen

import React, { useState } from 'react';
import {
  computeWeeklyCompliancePercentage,
  evaluateDaySummary,
  formatDateKey,
  formatMonthYearEs,
  formatRelativeDateLabel,
} from '../core/scheduler';
import type {
  BlockingRule,
  GlobalSettings,
  RoutineConfig,
  RoutineDayRecord,
} from '../core/types';
import { Icon } from './Icon';
import { getRoutineTheme } from './routineTheme';

interface HistoryScreenProps {
  now: Date;
  routines: RoutineConfig[];
  records: RoutineDayRecord[];
  blockingRules: BlockingRule[];
  settings: GlobalSettings;
}

const WEEKDAY_HEADERS_MON_FIRST = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  now,
  routines,
  records,
  blockingRules,
  settings,
}) => {
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0-11
  const todayKey = formatDateKey(now);
  const [inspectedDateKey, setInspectedDateKey] = useState(todayKey);

  // Conectado a la misma función que Hoy ("Semana") pasando `now` (solo cuenta alarmas ya vencidas hasta ahora)
  const compliance = computeWeeklyCompliancePercentage(
    now,
    routines,
    records,
    blockingRules,
    settings
  );

  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const firstDayWeekIdxSun0 = new Date(selectedYear, selectedMonth, 1).getDay();
  // Convertir domingo=0..sábado=6 a lunes=0..domingo=6
  const leadingEmptySlots = (firstDayWeekIdxSun0 + 6) % 7;

  const dayCells: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(selectedYear, selectedMonth, d, 12, 0, 0);
    dayCells.push(formatDateKey(dt));
  }

  const inspectedSummary = evaluateDaySummary(
    inspectedDateKey,
    todayKey,
    routines,
    records,
    blockingRules,
    settings
  );

  const changeMonth = (delta: number) => {
    const dt = new Date(selectedYear, selectedMonth + delta, 1);
    setSelectedYear(dt.getFullYear());
    setSelectedMonth(dt.getMonth());
  };

  // Geometría del mini-anillo de resumen de 7 días
  const ringSize = 90;
  const ringStroke = 12;
  const ringRadius = (ringSize - ringStroke) / 2;
  const ringCirc = 2 * Math.PI * ringRadius;
  const ringOffset = ringCirc * (1 - compliance.percentage / 100);

  const isViewingDifferentDayOrMonth =
    selectedYear !== now.getFullYear() ||
    selectedMonth !== now.getMonth() ||
    inspectedDateKey !== todayKey;

  return (
    <div className="bevel-today">
      <div className="bevel-screen-title-row">
        <h1 className="bevel-main-title">Historial</h1>
        {isViewingDifferentDayOrMonth && (
          <button
            type="button"
            className="bevel-row-action-pill"
            title="Volver a hoy"
            onClick={() => {
              setSelectedYear(now.getFullYear());
              setSelectedMonth(now.getMonth());
              setInspectedDateKey(todayKey);
            }}
          >
            <span>Ir a hoy</span>
          </button>
        )}
      </div>

      {/* Tarjeta de resumen con mini-anillo */}
      <section
        className="bevel-summary-ring-card"
        aria-label="Resumen de cumplimiento semanal"
      >
        <div className="mini-ring-box" style={{ width: ringSize, height: ringSize }}>
          <svg
            width={ringSize}
            height={ringSize}
            viewBox={`0 0 ${ringSize} ${ringSize}`}
            style={{ transform: 'rotate(-90deg)' }}
          >
            <defs>
              <linearGradient
                id="historyComplianceGrad"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#27d3af" />
                <stop offset="100%" stopColor="#0fa88a" />
              </linearGradient>
            </defs>
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={ringRadius}
              fill="none"
              stroke="var(--ring-track-bg)"
              strokeWidth={ringStroke}
            />
            <circle
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={ringRadius}
              fill="none"
              stroke="url(#historyComplianceGrad)"
              strokeWidth={ringStroke - 2}
              strokeLinecap="round"
              strokeDasharray={ringCirc}
              strokeDashoffset={ringOffset}
            />
          </svg>
          <div
            className="mini-sunken-well"
            style={{ width: 56, height: 56, fontSize: '17px' }}
          >
            {compliance.percentage}%
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="bevel-routine-name">Últimos 7 días</div>
          <div className="bevel-routine-sub" style={{ marginTop: '4px' }}>
            Hechas: <strong>{compliance.completedCount}</strong> de{' '}
            <strong>{compliance.evaluableCount}</strong> vencidas
          </div>
          <div className="bevel-routine-sub" style={{ marginTop: '2px' }}>
            Omitidas por dermastamp:{' '}
            <strong style={{ color: '#c4b5fd' }}>{compliance.omittedCount}</strong>
          </div>
        </div>
      </section>

      {/* Calendario mensual con indicadores bajo cada día */}
      <section className="bevel-calendar-card" aria-label="Calendario mensual">
        <div className="calendar-card-header">
          <button
            type="button"
            className="circle-outline-btn"
            style={{ width: 40, height: 40 }}
            aria-label="Mes anterior"
            onClick={() => changeMonth(-1)}
          >
            <Icon name="CaretLeft" size={20} weight="bold" />
          </button>

          <div className="calendar-month-title">
            {formatMonthYearEs(selectedYear, selectedMonth)}
          </div>

          <button
            type="button"
            className="circle-outline-btn"
            style={{ width: 40, height: 40 }}
            aria-label="Mes siguiente"
            onClick={() => changeMonth(1)}
          >
            <Icon name="CaretRight" size={20} weight="bold" />
          </button>
        </div>

        <div className="calendar-weekdays-row">
          {WEEKDAY_HEADERS_MON_FIRST.map((w) => (
            <span key={w} className="calendar-weekday-label">
              {w}
            </span>
          ))}
        </div>

        <div className="calendar-days-grid">
          {Array.from({ length: leadingEmptySlots }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {dayCells.map((dateKey) => {
            const hasHistoryOnOrBefore = records.some(
              (r) => r.dateKey <= dateKey
            );
            const summary = evaluateDaySummary(
              dateKey,
              todayKey,
              routines,
              records,
              blockingRules,
              settings
            );
            const dayNum = Number(dateKey.split('-')[2]);
            const isSelected = inspectedDateKey === dateKey;
            const isToday = dateKey === todayKey;

            // Determinar el indicador bajo el día:
            // - verde: completado
            // - discontinuo: omitido por dermastamp (o tiene alguna tarea omitida ese día)
            // - rojo atenuado: día pasado saltado (solo si ya había historial iniciado)
            const hasOmitted =
              summary.overallStatus === 'omitted_by_block' ||
              summary.routineStatuses.some(
                (s) => s.status === 'omitted_by_block'
              );
            let indicatorClass = 'dot-pending';
            if (summary.overallStatus === 'completed') {
              indicatorClass = 'dot-completed';
            } else if (hasOmitted) {
              indicatorClass = 'dot-omitted';
            } else if (
              summary.overallStatus === 'skipped' &&
              hasHistoryOnOrBefore
            ) {
              indicatorClass = 'dot-skipped';
            }

            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => setInspectedDateKey(dateKey)}
                className={`bevel-day-cell ${isSelected ? 'selected' : ''} ${
                  isToday ? 'is-today' : ''
                }`}
              >
                <span className="bevel-day-num">{dayNum}</span>
                <span className={`bevel-day-indicator ${indicatorClass}`} />
              </button>
            );
          })}
        </div>

        <div className="calendar-legend-row">
          <span className="legend-item">
            <span className="bevel-day-indicator dot-completed" />
            <span>Hecho</span>
          </span>
          <span className="legend-item">
            <span className="bevel-day-indicator dot-omitted" />
            <span>Omitido</span>
          </span>
          <span className="legend-item">
            <span className="bevel-day-indicator dot-skipped" />
            <span>Saltado</span>
          </span>
        </div>
      </section>

      {/* Detalle del día seleccionado como filas */}
      <div className="bevel-section-header">
        <h2 className="bevel-section-title">
          Detalle · {formatRelativeDateLabel(inspectedDateKey, todayKey)}
        </h2>
      </div>

      <section className="bevel-routine-cards-stack">
        {inspectedSummary.routineStatuses.map((st) => {
          const theme = getRoutineTheme(st.routineId);
          return (
            <div key={st.routineId} className="bevel-routine-row-card">
              <div className="bevel-row-top">
                <div className="bevel-row-left">
                  <div
                    className="bevel-routine-orb"
                    style={{
                      background: theme.orbGradient,
                      boxShadow: theme.orbShadow,
                    }}
                  >
                    <Icon
                      name={theme.iconName}
                      size={26}
                      weight="fill"
                      color="#ffffff"
                    />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="bevel-routine-name">{st.routineName}</div>
                    <div className="bevel-routine-sub">
                      {st.status === 'completed' && 'Completada a tiempo'}
                      {st.status === 'omitted_by_block' &&
                        'Bloqueado por dermastamp (no penaliza)'}
                      {st.status === 'skipped' && 'No registrada ese día'}
                      {st.status === 'pending' && 'En curso / Programada'}
                    </div>
                  </div>
                </div>

                <span
                  className={`history-status-pill status-${st.status}`}
                >
                  {st.status === 'completed' && (
                    <>
                      <Icon name="Check" size={15} weight="bold" color="#27d3af" />
                      <span>Hecho</span>
                    </>
                  )}
                  {st.status === 'omitted_by_block' && (
                    <>
                      <Icon
                        name="ShieldCheck"
                        size={15}
                        weight="fill"
                        color="#c4b5fd"
                      />
                      <span>Omitido</span>
                    </>
                  )}
                  {st.status === 'skipped' && <span>Saltado</span>}
                  {st.status === 'pending' && <span>Pendiente</span>}
                </span>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
};

// @end: History-And-Calendar-Screen
