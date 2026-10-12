// @section: Settings-And-Diagnostics-Screen

import React, { useState } from 'react';
import { formatHHMM, resolveRoutinePrimaryHHMM } from '../core/scheduler';
import type { GlobalSettings, ScheduledPrompt } from '../core/types';
import { IOSSwitch, TimePickerSheet } from './CustomControls';
import { Icon } from './Icon';
import { getRoutineTheme } from './routineTheme';

interface SettingsScreenProps {
  settings: GlobalSettings;
  permissionStatus: string;
  activeScheduledPrompts: ScheduledPrompt[];
  onUpdateSettings: (next: GlobalSettings) => void;
  onRequestPermissions: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  permissionStatus,
  activeScheduledPrompts,
  onUpdateSettings,
  onRequestPermissions,
}) => {
  const [showSleepPicker, setShowSleepPicker] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const derivedMinoxidilHHMM = resolveRoutinePrimaryHHMM(
    {
      id: 'minoxidil',
      name: 'Minoxidil',
      enabled: true,
      scheduleType: 'relative_to_sleep',
      offsetBeforeSleepMinutes: -120,
      insistIntervalMinutes: 10,
      insistDurationMinutes: 120,
      allowDiscreetMode: true,
    },
    settings
  );
  const minoxidilTheme = getRoutineTheme('minoxidil');

  const isGranted =
    permissionStatus.toLowerCase().includes('concedido') ||
    permissionStatus.toLowerCase().includes('granted');

  return (
    <div className="bevel-today">
      <div className="bevel-top-actions">
        <div className="circle-outline-btn" style={{ cursor: 'default' }}>
          <Icon name="GearSix" size={24} weight="bold" />
        </div>
        <button
          type="button"
          className="circle-outline-btn"
          title="Diagnóstico"
          onClick={() => setDiagnosticsOpen((v) => !v)}
        >
          <Icon name="DotsThree" size={24} weight="bold" />
        </button>
      </div>

      <div className="bevel-screen-title-row">
        <h1 className="bevel-main-title">Ajustes</h1>
      </div>

      {/* Grupo 1: Descanso y hora derivada de Minoxidil */}
      <div className="bevel-section-header">
        <h2 className="bevel-day-group-title">Descanso global</h2>
      </div>

      <section className="ios-grouped-card" aria-label="Ajuste de hora de dormir">
        <div
          role="button"
          tabIndex={0}
          className="ios-grouped-row interactive-row"
          onClick={() => setShowSleepPicker(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowSleepPicker(true);
            }
          }}
        >
          <div className="bevel-row-left">
            <div
              className="bevel-routine-orb"
              style={{
                background: 'linear-gradient(180deg, #818cf8 0%, #4f46e5 100%)',
                boxShadow:
                  '0 8px 18px rgba(79, 70, 229, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.38)',
              }}
            >
              <Icon name="Moon" size={26} weight="fill" color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="bevel-routine-name">Hora de dormir</div>
              <div className="bevel-routine-sub">
                Reprograma automáticamente las alarmas
              </div>
            </div>
          </div>

          <button
            type="button"
            className="time-trigger-pill"
            onClick={(e) => {
              e.stopPropagation();
              setShowSleepPicker(true);
            }}
          >
            <Icon name="Clock" size={18} weight="bold" />
            <span>{settings.sleepTimeHHMM}</span>
          </button>
        </div>

        <div className="ios-grouped-row">
          <div className="bevel-row-left">
            <div
              className="bevel-routine-orb"
              style={{
                background: minoxidilTheme.orbGradient,
                boxShadow: minoxidilTheme.orbShadow,
              }}
            >
              <Icon name="Drop" size={26} weight="fill" color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="bevel-routine-name">Minoxidil (derivada)</div>
              <div className="bevel-routine-sub">
                Calculada sola: Hora de dormir − 2 h
              </div>
            </div>
          </div>

          <span className="derived-time-badge">{derivedMinoxidilHHMM}</span>
        </div>
      </section>

      {/* Grupo 2: Permisos del dispositivo */}
      <div className="bevel-section-header" style={{ marginTop: '4px' }}>
        <h2 className="bevel-day-group-title">Permisos de alarma</h2>
      </div>

      <section className="ios-grouped-card" aria-label="Permisos de notificaciones">
        <div className="ios-grouped-row">
          <div className="bevel-row-left">
            <div
              className="bevel-routine-orb"
              style={{
                background: 'linear-gradient(180deg, #34d399 0%, #059669 100%)',
                boxShadow:
                  '0 8px 18px rgba(5, 150, 105, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.38)',
              }}
            >
              <Icon
                name="BellRinging"
                size={26}
                weight="fill"
                color="#ffffff"
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="bevel-routine-name">Avisos y sonidos</div>
              <div className="bevel-routine-sub">
                Necesario para sonar con el móvil bloqueado
              </div>
            </div>
          </div>

          <span
            className={`history-status-pill ${
              isGranted ? 'status-completed' : 'status-pending'
            }`}
          >
            {isGranted ? 'Concedido' : permissionStatus}
          </span>
        </div>

        <div style={{ padding: '4px 0 2px' }}>
          <button
            type="button"
            className="primary-action-btn"
            style={{ width: '100%' }}
            onClick={onRequestPermissions}
          >
            <Icon name="BellRinging" size={20} weight="fill" />
            <span>Solicitar permisos</span>
          </button>
        </div>
      </section>

      {/* Grupo 3: Sección Diagnóstico colapsada por defecto */}
      <section className="ios-grouped-card" aria-label="Diagnóstico técnico">
        <button
          type="button"
          className="diagnostics-accordion-trigger"
          onClick={() => setDiagnosticsOpen((v) => !v)}
        >
          <div className="bevel-row-left">
            <div
              className="chip-gradient-orb"
              style={{
                background: 'linear-gradient(180deg, #64748b 0%, #334155 100%)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.28)',
              }}
            >
              <Icon name="ShieldCheck" size={22} weight="fill" color="#ffffff" />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div className="bevel-routine-name" style={{ fontSize: '18px' }}>
                Diagnóstico
              </div>
              <div className="bevel-routine-sub" style={{ marginTop: '2px' }}>
                Cola de avisos, IDs y ajustes avanzados
              </div>
            </div>
          </div>

          <Icon
            name={diagnosticsOpen ? 'CaretDown' : 'CaretRight'}
            size={20}
            weight="bold"
            color="var(--text-secondary)"
          />
        </button>

        {diagnosticsOpen && (
          <div className="diagnostics-body">
            <div className="ios-grouped-row">
              <div style={{ minWidth: 0 }}>
                <div className="sheet-field-label">
                  Entitlement Time-Sensitive
                </div>
                <div className="sheet-field-sub">
                  Opcional según el perfil de aprovisionamiento en iOS
                </div>
              </div>
              <IOSSwitch
                checked={settings.useTimeSensitiveEntitlement}
                ariaLabel="Activar Time-Sensitive"
                onChange={(checked) =>
                  onUpdateSettings({
                    ...settings,
                    useTimeSensitiveEntitlement: checked,
                  })
                }
              />
            </div>

            <div className="ios-grouped-row">
              <div className="sheet-field-label">Avisos en cola (máx. 60)</div>
              <span className="derived-time-badge">
                {activeScheduledPrompts.length}
              </span>
            </div>

            <div className="diagnostics-queue-list">
              {activeScheduledPrompts.slice(0, 8).map((p) => {
                const dt = new Date(p.scheduledAtISO);
                const hhmm = formatHHMM(dt.getHours(), dt.getMinutes());
                return (
                  <div key={p.deterministicId} className="diagnostics-queue-item">
                    <span>
                      {p.dateKey} {hhmm} · {p.routineName}
                    </span>
                    <span>#{p.notificationNumericId}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <TimePickerSheet
        open={showSleepPicker}
        title="Hora de dormir"
        subtitle="Minoxidil se programará automáticamente 2 h antes"
        initialHHMM={settings.sleepTimeHHMM}
        onClose={() => setShowSleepPicker(false)}
        onConfirm={(hhmm) =>
          onUpdateSettings({ ...settings, sleepTimeHHMM: hhmm })
        }
      />
    </div>
  );
};

// @end: Settings-And-Diagnostics-Screen
