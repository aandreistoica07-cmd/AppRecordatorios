// @section: Screen-History-Calendar

import React, { useState } from 'react';
import {
  computeWeeklyCompliancePercentage,
  evaluateDaySummary,
  formatDateKey,
} from '../core/scheduler';
import type {
  BlockingRule,
  GlobalSettings,
  RoutineConfig,
  RoutineDayRecord,
} from '../core/types';

interface HistoryScreenProps {
  now: Date;
  routines: RoutineConfig[];
  records: RoutineDayRecord[];
  blockingRules: BlockingRule[];
  settings: GlobalSettings;
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  now,
  routines,
  records,
  blockingRules,
  settings,
}) => {
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0-11
  const [inspectedDateKey, setInspectedDateKey] = useState(formatDateKey(now));

  const todayKey = formatDateKey(now);
  const compliance = computeWeeklyCompliancePercentage(
    todayKey,
    routines,
    records,
    blockingRules,
    settings
  );

  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const monthName = new Date(selectedYear, selectedMonth, 1).toLocaleString(
    'es-ES',
    { month: 'long', year: 'numeric' }
  );

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <header className="screen-header">
        <h1 className="screen-title">Historial</h1>
        <div className="streak-pill">
          Cumplimiento 7d: {compliance.percentage}%
        </div>
      </header>

      <div className="clock-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div className="routine-subtext">Cumplimiento últimos 7 días</div>
            <div className="time-huge">{compliance.percentage}%</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="routine-subtext">
              Hechas: <strong>{compliance.completedCount}</strong> /{' '}
              {compliance.evaluableCount}
            </div>
            <div className="routine-subtext">
              Omitidas por dermastamp (no penalizan):{' '}
              <strong style={{ color: 'var(--accent)' }}>
                {compliance.omittedCount}
              </strong>
            </div>
          </div>
        </div>
      </div>

      <div className="clock-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <button className="chip-btn" onClick={() => changeMonth(-1)}>
            ◀
          </button>
          <strong style={{ textTransform: 'capitalize', fontSize: '1.1rem' }}>
            {monthName}
          </strong>
          <button className="chip-btn" onClick={() => changeMonth(1)}>
            ▶
          </button>
        </div>

        <div className="calendar-grid" style={{ marginTop: 8 }}>
          {dayCells.map((dateKey) => {
            const summary = evaluateDaySummary(
              dateKey,
              todayKey,
              routines,
              records,
              blockingRules,
              settings
            );
            const dayNum = Number(dateKey.split('-')[2]);
            return (
              <button
                key={dateKey}
                onClick={() => setInspectedDateKey(dateKey)}
                className={`calendar-cell status-${summary.overallStatus}`}
                style={{
                  outline:
                    inspectedDateKey === dateKey
                      ? '2px solid #ffffff'
                      : 'none',
                  cursor: 'pointer',
                }}
              >
                <span>{dayNum}</span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            marginTop: 8,
            fontSize: '0.82rem',
          }}
        >
          <span className="badge-accent">■ Hecho</span>
          <span
            className="badge-accent"
            style={{ borderStyle: 'dashed', background: 'transparent' }}
          >
            ▨ Omitido (Dermastamp)
          </span>
          <span className="badge-muted">Saltado / Pendiente</span>
        </div>
      </div>

      {/* Detalle del día seleccionado */}
      <div className="clock-card">
        <div className="routine-label">Detalle del {inspectedDateKey}</div>
        {inspectedSummary.routineStatuses.map((st) => (
          <div key={st.routineId} className="form-row">
            <span>{st.routineName}</span>
            <span
              className={
                st.status === 'completed' || st.status === 'omitted_by_block'
                  ? 'badge-accent'
                  : 'badge-muted'
              }
            >
              {st.status === 'completed' && '✓ Hecho'}
              {st.status === 'omitted_by_block' &&
                `🛡️ ${st.reason ?? 'Omitido por dermastamp'}`}
              {st.status === 'skipped' && '✕ Saltado'}
              {st.status === 'pending' && '⏳ Pendiente'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// @end: Screen-History-Calendar
