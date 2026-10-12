// @section: Screen-Settings

import React from 'react';
import type { GlobalSettings } from '../core/types';

const WEEKDAYS_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

interface SettingsScreenProps {
  settings: GlobalSettings;
  permissionStatus: string;
  onUpdateSettings: (next: GlobalSettings) => void;
  onRequestPermissions: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  permissionStatus,
  onUpdateSettings,
  onRequestPermissions,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <header className="screen-header">
        <h1 className="screen-title">Ajustes</h1>
      </header>

      <div className="clock-card">
        <div className="routine-label">Horarios Globales</div>
        <p className="routine-subtext">
          Al cambiar cualquiera de estos valores, se reprograman automáticamente
          todas las alarmas de los próximos 7 días.
        </p>

        <div className="form-row">
          <div>
            <div>Hora de dormir</div>
            <div className="routine-subtext">
              Minoxidil sonará 2 horas antes de esta hora
            </div>
          </div>
          <input
            type="time"
            className="input-dark"
            value={settings.sleepTimeHHMM}
            onChange={(e) =>
              onUpdateSettings({ ...settings, sleepTimeHHMM: e.target.value })
            }
          />
        </div>

        <div className="form-row">
          <div>
            <div>Pastilla · Mañana</div>
            <div className="routine-subtext">Insiste cada 10 min durante 1h</div>
          </div>
          <input
            type="time"
            className="input-dark"
            value={settings.pillMorningTimeHHMM}
            onChange={(e) =>
              onUpdateSettings({
                ...settings,
                pillMorningTimeHHMM: e.target.value,
              })
            }
          />
        </div>

        <div className="form-row">
          <div>
            <div>Pastilla · Tarde (2º aviso)</div>
            <div className="routine-subtext">
              Con opción "No estoy en casa" (+1h hasta 22:00)
            </div>
          </div>
          <input
            type="time"
            className="input-dark"
            value={settings.pillAfternoonTimeHHMM}
            onChange={(e) =>
              onUpdateSettings({
                ...settings,
                pillAfternoonTimeHHMM: e.target.value,
              })
            }
          />
        </div>

        <div className="form-row">
          <div>Día del Dermastamp</div>
          <select
            className="input-dark"
            value={settings.dermastampWeekday}
            onChange={(e) =>
              onUpdateSettings({
                ...settings,
                dermastampWeekday: Number(e.target.value),
              })
            }
          >
            {WEEKDAYS_ES.map((day, idx) => (
              <option key={day} value={idx}>
                {day}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div>Hora del Dermastamp</div>
          <input
            type="time"
            className="input-dark"
            value={settings.dermastampTimeHHMM}
            onChange={(e) =>
              onUpdateSettings({
                ...settings,
                dermastampTimeHHMM: e.target.value,
              })
            }
          />
        </div>
      </div>

      <div className="clock-card">
        <div className="routine-label">Permisos y Sistema (iOS 26)</div>
        <div className="form-row">
          <div>
            <div>Estado de permisos de avisos</div>
            <div className="routine-subtext">{permissionStatus}</div>
          </div>
          <button className="chip-btn active" onClick={onRequestPermissions}>
            Solicitar permisos
          </button>
        </div>

        <div className="form-row">
          <div>
            <div>Nivel de interrupción Time-Sensitive</div>
            <div className="routine-subtext">
              Desactivado por defecto (`active`) para compatibilidad con firma
              gratuita Sideloadly/SideStore
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.useTimeSensitiveEntitlement}
            onChange={(e) =>
              onUpdateSettings({
                ...settings,
                useTimeSensitiveEntitlement: e.target.checked,
              })
            }
          />
        </div>
      </div>
    </div>
  );
};

// @end: Screen-Settings
