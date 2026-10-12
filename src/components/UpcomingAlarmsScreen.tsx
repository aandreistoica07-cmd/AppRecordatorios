// @section: Screen-Upcoming-7Days

import React from 'react';
import { formatHHMM } from '../core/scheduler';
import type { ScheduledPrompt } from '../core/types';

interface UpcomingAlarmsScreenProps {
  upcomingOverview: ScheduledPrompt[];
  activeScheduledPrompts: ScheduledPrompt[];
}

export const UpcomingAlarmsScreen: React.FC<UpcomingAlarmsScreenProps> = ({
  upcomingOverview,
  activeScheduledPrompts,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <header className="screen-header">
        <div>
          <h1 className="screen-title">Próximas 7 días</h1>
          <p className="routine-subtext">
            {activeScheduledPrompts.length} avisos activos en cola del sistema
          </p>
        </div>
      </header>

      {upcomingOverview.map((item) => {
        const dt = new Date(item.scheduledAtISO);
        const hhmm = formatHHMM(dt.getHours(), dt.getMinutes());
        return (
          <div
            key={item.deterministicId}
            className={`clock-card ${item.blocked ? 'omitted' : ''}`}
            style={{ padding: '18px 20px' }}
          >
            <div className="clock-card-top">
              <div>
                <div className="routine-subtext">{item.dateKey}</div>
                <div className="time-huge" style={{ fontSize: '2.35rem' }}>
                  {hhmm}
                </div>
                <div className="routine-label">{item.routineName}</div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 6,
                }}
              >
                {item.blocked ? (
                  <span className="badge-accent">
                    🚫 Bloqueado ({item.blockedReason})
                  </span>
                ) : (
                  <span className="badge-muted">
                    {item.channel === 'alarmkit'
                      ? '🔊 Alarma'
                      : '🔕 Notificación discreta'}
                  </span>
                )}
                <span
                  className="routine-subtext"
                  style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}
                >
                  ID #{item.notificationNumericId}
                </span>
              </div>
            </div>
            {item.blocked && item.blockedByCompletedAtISO && (
              <div className="routine-subtext">
                Cancelada automáticamente por marcado dentro de las 24h previas (
                {new Date(item.blockedByCompletedAtISO).toLocaleString('es-ES')}
                ).
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// @end: Screen-Upcoming-7Days
