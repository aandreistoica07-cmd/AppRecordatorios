// @section: Settings-And-Diagnostics-Screen

import React, { useState } from 'react';
import {
  computeSideloadSignatureStatus,
  DEFAULT_MAX_INSISTENCE_COUNT,
  formatHHMM,
  resolveRoutinePrimaryHHMM,
} from '../core/scheduler';
import type {
  GlobalSettings,
  ScheduledPrompt,
  SystemNotificationPermissions,
} from '../core/types';
import { triggerLightHaptic } from '../services/deviceBridge';
import {
  scheduleTestAlarmInOneMinute,
  scheduleTestNotificationInOneMinute,
} from '../services/notificationAdapter';
import {
  IOSSwitch,
  SegmentedControl,
  TimePickerSheet,
} from './CustomControls';
import { Icon } from './Icon';
import { getRoutineTheme } from './routineTheme';

interface SettingsScreenProps {
  now: Date;
  settings: GlobalSettings;
  permissionStatus: string;
  permissionDetails: SystemNotificationPermissions;
  activeScheduledPrompts: ScheduledPrompt[];
  onUpdateSettings: (next: GlobalSettings) => void;
  onRequestPermissions: () => void;
  onRefreshPermissions?: () => void;
  onMarkSideloadReinstalled: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  now,
  settings,
  permissionStatus,
  permissionDetails,
  activeScheduledPrompts,
  onUpdateSettings,
  onRequestPermissions,
  onRefreshPermissions,
  onMarkSideloadReinstalled,
}) => {
  const [showSleepPicker, setShowSleepPicker] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [testFeedbackText, setTestFeedbackText] = useState<string | null>(null);
  const [testFeedbackError, setTestFeedbackError] = useState<boolean>(false);

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
    permissionDetails.display === 'granted' ||
    permissionStatus.toLowerCase().includes('concedido') ||
    permissionStatus.toLowerCase().includes('granted');

  const sideloadStatus = computeSideloadSignatureStatus(
    now,
    settings.lastSideloadReinstallISO
  );
  const maxInsistStr = String(
    settings.maxInsistenceCount ?? DEFAULT_MAX_INSISTENCE_COUNT
  ) as '3' | '6' | '9' | '12';

  return (
    <div className="bevel-today">
      <div className="bevel-screen-title-row">
        <h1 className="bevel-main-title">Ajustes</h1>
      </div>

      {/* Grupo 1: Descanso, hora derivada de Minoxidil y ráfaga máxima de insistencias */}
      <div className="bevel-section-header">
        <h2 className="bevel-day-group-title">Descanso global y avisos</h2>
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

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingTop: '10px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div className="sheet-field-label">
                Límite de ráfaga de insistencias
              </div>
              <div className="sheet-field-sub">
                Máximo de recordatorios extra por tarea (por defecto 6)
              </div>
            </div>
            <span className="derived-time-badge">
              {settings.maxInsistenceCount ?? DEFAULT_MAX_INSISTENCE_COUNT}
            </span>
          </div>
          <SegmentedControl<'3' | '6' | '9' | '12'>
            options={[
              { value: '3', label: '3' },
              { value: '6', label: '6' },
              { value: '9', label: '9' },
              { value: '12', label: '12' },
            ]}
            value={
              ['3', '6', '9', '12'].includes(maxInsistStr) ? maxInsistStr : '6'
            }
            onChange={(val) =>
              onUpdateSettings({
                ...settings,
                maxInsistenceCount: Number(val),
              })
            }
          />
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

      {/* Grupo 3: Firma de la app (Sideloadly 7 días) */}
      <div className="bevel-section-header" style={{ marginTop: '4px' }}>
        <h2 className="bevel-day-group-title">Firma de la app</h2>
      </div>

      <section className="ios-grouped-card" aria-label="Firma de la app Sideloadly">
        <div className="ios-grouped-row">
          <div className="bevel-row-left">
            <div
              className="bevel-routine-orb"
              style={{
                background: 'linear-gradient(180deg, #fbbf24 0%, #d97706 100%)',
                boxShadow:
                  '0 8px 18px rgba(217, 119, 6, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.38)',
              }}
            >
              <Icon name="ShieldCheck" size={26} weight="fill" color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="bevel-routine-name">Certificado de 7 días</div>
              <div className="bevel-routine-sub">
                {sideloadStatus.configured
                  ? 'Aviso programado el día 6 para reinstalar con Sideloadly'
                  : 'Pulsa al reinstalar para programar el aviso del día 6'}
              </div>
            </div>
          </div>

          <span
            className={`history-status-pill ${
              !sideloadStatus.configured
                ? 'status-pending'
                : sideloadStatus.remainingDays !== null &&
                  sideloadStatus.remainingDays <= 1
                ? 'status-pending'
                : 'status-completed'
            }`}
          >
            {!sideloadStatus.configured
              ? 'Sin registrar'
              : sideloadStatus.expired
              ? 'Caducada'
              : `${sideloadStatus.remainingDays} ${
                  sideloadStatus.remainingDays === 1 ? 'día' : 'días'
                }`}
          </span>
        </div>

        <div style={{ padding: '4px 0 2px' }}>
          <button
            type="button"
            className="primary-action-btn"
            style={{ width: '100%' }}
            onClick={onMarkSideloadReinstalled}
          >
            <Icon name="CheckCircle" size={20} weight="fill" />
            <span>Acabo de reinstalar</span>
          </button>
        </div>
      </section>

      {/* Grupo 4: Sección Diagnóstico colapsada por defecto */}
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
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                paddingBottom: '8px',
              }}
            >
              <button
                type="button"
                className="primary-action-btn"
                style={{ width: '100%' }}
                onClick={async () => {
                  void triggerLightHaptic();
                  const res = await scheduleTestNotificationInOneMinute(settings);
                  setTestFeedbackError(false);
                  setTestFeedbackText(
                    `Aviso de prueba programado: sonará a las ${res.targetTimeHHMMSS}`
                  );
                }}
              >
                <Icon name="BellRinging" size={18} weight="fill" />
                <span>Aviso de prueba en 1 minuto</span>
              </button>

              <button
                type="button"
                className="primary-action-btn"
                style={{ width: '100%' }}
                onClick={async () => {
                  void triggerLightHaptic();
                  const res = await scheduleTestAlarmInOneMinute(settings);
                  onRefreshPermissions?.();
                  const permLabel = res.permissionGranted
                    ? `Concedido (${res.authorizationState})`
                    : `Denegado / No disponible (${res.authorizationState})`;
                  if (res.ok) {
                    setTestFeedbackError(false);
                    setTestFeedbackText(
                      `AlarmKit OK · Permiso: ${permLabel} · Sonará a las ${res.targetTimeHHMMSS} (UUID: ${
                        res.alarmUuid?.slice(0, 8) ?? 'n/a'
                      })`
                    );
                  } else {
                    setTestFeedbackError(true);
                    setTestFeedbackText(
                      `AlarmKit falló · Permiso: ${permLabel} · Hora objetivo: ${
                        res.targetTimeHHMMSS
                      } · Error: ${res.error ?? 'Desconocido'}`
                    );
                  }
                }}
              >
                <Icon name="SpeakerHigh" size={18} weight="fill" />
                <span>Alarma de prueba en 1 minuto</span>
              </button>

              {testFeedbackText && (
                <div
                  role="status"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: testFeedbackError
                      ? '#fca5a5'
                      : 'var(--accent-emerald)',
                    textAlign: 'left',
                    padding: '8px 12px',
                    borderRadius: '12px',
                    background: testFeedbackError
                      ? 'rgba(239, 68, 68, 0.14)'
                      : 'rgba(49, 196, 149, 0.12)',
                    border: testFeedbackError
                      ? '1px solid rgba(248, 113, 113, 0.35)'
                      : '1px solid rgba(49, 196, 149, 0.25)',
                    fontVariantNumeric: 'tabular-nums',
                    overflowWrap: 'break-word',
                  }}
                >
                  {testFeedbackText}
                </div>
              )}
            </div>

            <div className="ios-grouped-row">
              <div style={{ minWidth: 0 }}>
                <div className="sheet-field-label">Permiso de Alertas</div>
                <div className="sheet-field-sub">
                  Estado real leído del plugin ({permissionDetails.display})
                </div>
              </div>
              <span
                className={`history-status-pill ${
                  permissionDetails.alerts === 'Concedido'
                    ? 'status-completed'
                    : 'status-pending'
                }`}
              >
                {permissionDetails.alerts}
              </span>
            </div>

            <div className="ios-grouped-row">
              <div className="sheet-field-label">Permiso de Sonido</div>
              <span
                className={`history-status-pill ${
                  permissionDetails.sound === 'Concedido'
                    ? 'status-completed'
                    : 'status-pending'
                }`}
              >
                {permissionDetails.sound}
              </span>
            </div>

            <div className="ios-grouped-row">
              <div className="sheet-field-label">Permiso de Insignias</div>
              <span
                className={`history-status-pill ${
                  permissionDetails.badges === 'Concedido'
                    ? 'status-completed'
                    : 'status-pending'
                }`}
              >
                {permissionDetails.badges}
              </span>
            </div>

            <div className="ios-grouped-row">
              <div className="sheet-field-label">Centro de notificaciones</div>
              <span
                className={`history-status-pill ${
                  permissionDetails.enabledInNotificationCenter
                    ? 'status-completed'
                    : 'status-pending'
                }`}
              >
                {permissionDetails.enabledInNotificationCenter
                  ? 'Activo'
                  : 'Inactivo'}
              </span>
            </div>

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
