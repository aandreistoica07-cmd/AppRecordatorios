// @section: Upcoming-Alarms-Screen

import React from 'react';
import {
  formatDateKey,
  formatHHMM,
  formatRelativeDateLabel,
} from '../core/scheduler';
import type { ScheduledPrompt } from '../core/types';
import { Icon } from './Icon';
import { getRoutineTheme } from './routineTheme';

interface UpcomingAlarmsScreenProps {
  now: Date;
  upcomingOverview: ScheduledPrompt[];
  onOpenSettingsTab?: () => void;
}

export const UpcomingAlarmsScreen: React.FC<UpcomingAlarmsScreenProps> = ({
  now,
  upcomingOverview,
  onOpenSettingsTab,
}) => {
  const todayKey = formatDateKey(now);
  const nowMs = now.getTime();

  // Filtrar las alarmas de hoy cuya hora ya haya pasado y agrupar por dateKey
  const groupedByDate = React.useMemo(() => {
    const groups: { dateKey: string; items: ScheduledPrompt[] }[] = [];
    for (const item of upcomingOverview) {
      const scheduledMs = new Date(item.scheduledAtISO).getTime();
      if (item.dateKey === todayKey && scheduledMs <= nowMs) {
        continue;
      }

      const last = groups[groups.length - 1];
      if (!last || last.dateKey !== item.dateKey) {
        groups.push({ dateKey: item.dateKey, items: [item] });
      } else {
        last.items.push(item);
      }
    }
    return groups;
  }, [upcomingOverview, todayKey, nowMs]);

  return (
    <div className="bevel-today">
      <div className="bevel-top-actions">
        <div className="circle-outline-btn" style={{ cursor: 'default' }}>
          <Icon name="BellRinging" size={24} weight="bold" />
        </div>
        <button
          type="button"
          className="circle-outline-btn"
          title="Ajustes"
          onClick={() => onOpenSettingsTab?.()}
        >
          <Icon name="DotsThree" size={24} weight="bold" />
        </button>
      </div>

      <div className="bevel-screen-title-row">
        <h1 className="bevel-main-title">Próximas</h1>
      </div>

      {groupedByDate.length === 0 ? (
        <div className="bevel-empty-dashed-box">
          <Icon name="CheckCircle" size={28} weight="fill" color="#27d3af" />
          <span>No hay alarmas pendientes en los próximos 7 días</span>
        </div>
      ) : (
        groupedByDate.map((group) => {
          const sectionTitle = formatRelativeDateLabel(group.dateKey, todayKey);
          return (
            <section
              key={group.dateKey}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
              aria-label={`Alarmas de ${sectionTitle}`}
            >
              <div className="bevel-section-header" style={{ marginTop: '2px' }}>
                <h2 className="bevel-day-group-title">{sectionTitle}</h2>
              </div>

              <div className="bevel-routine-cards-stack">
                {group.items.map((item) => {
                  const dt = new Date(item.scheduledAtISO);
                  const hhmm = formatHHMM(dt.getHours(), dt.getMinutes());
                  const theme = getRoutineTheme(item.routineId);
                  const isAfternoonPill = item.kind === 'secondary_primary';

                  return (
                    <div
                      key={item.deterministicId}
                      className={`bevel-routine-row-card ${
                        item.blocked ? 'is-blocked-dashed' : ''
                      }`}
                    >
                      <div className="bevel-row-top">
                        <div className="bevel-row-left">
                          <div
                            className="bevel-routine-orb"
                            style={{
                              background: theme.orbGradient,
                              boxShadow: theme.orbShadow,
                              opacity: item.blocked ? 0.55 : 1,
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
                            <div className="bevel-routine-name">
                              {item.routineName}
                            </div>
                            {item.blocked ? (
                              <div className="blocked-tag-pill">
                                <Icon
                                  name="ShieldCheck"
                                  size={15}
                                  weight="fill"
                                  color="#c4b5fd"
                                />
                                <span>Bloqueado por dermastamp</span>
                              </div>
                            ) : (
                              <div className="bevel-routine-sub">
                                {isAfternoonPill
                                  ? 'Solo si no la has tomado'
                                  : item.channel === 'alarmkit'
                                  ? 'Alarma principal'
                                  : 'Modo discreto'}
                              </div>
                            )}
                          </div>
                        </div>

                        <div
                          className={`upcoming-big-time ${
                            item.blocked ? 'is-strikethrough' : ''
                          }`}
                        >
                          {hhmm}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
};

// @end: Upcoming-Alarms-Screen
