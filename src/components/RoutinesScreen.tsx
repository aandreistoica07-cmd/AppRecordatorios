// @section: Screen-Routines

import React, { useState } from 'react';
import { resolveRoutinePrimaryHHMM } from '../core/scheduler';
import type {
  BlockingRule,
  GlobalSettings,
  RoutineConfig,
  ScheduleType,
} from '../core/types';

const WEEKDAYS_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

interface RoutinesScreenProps {
  routines: RoutineConfig[];
  blockingRules: BlockingRule[];
  settings: GlobalSettings;
  onUpdateRoutine: (updated: RoutineConfig) => void;
  onAddRoutine: (newRoutine: RoutineConfig) => void;
  onAddBlockingRule: (newRule: BlockingRule) => void;
  onDeleteBlockingRule: (ruleId: string) => void;
}

export const RoutinesScreen: React.FC<RoutinesScreenProps> = ({
  routines,
  blockingRules,
  settings,
  onUpdateRoutine,
  onAddRoutine,
  onAddBlockingRule,
  onDeleteBlockingRule,
}) => {
  const [newName, setNewName] = useState('');
  const [newScheduleType, setNewScheduleType] =
    useState<ScheduleType>('fixed_daily');
  const [newTimeHHMM, setNewTimeHHMM] = useState('12:00');
  const [newInsistMin, setNewInsistMin] = useState(10);

  const [ruleSource, setRuleSource] = useState(routines[0]?.id ?? 'dermastamp');
  const [ruleTarget, setRuleTarget] = useState(routines[0]?.id ?? 'minoxidil');
  const [ruleHours, setRuleHours] = useState(24);

  const handleCreateRoutine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = newName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    onAddRoutine({
      id: `${id}-${Date.now().toString().slice(-3)}`,
      name: newName.trim(),
      enabled: true,
      scheduleType: newScheduleType,
      fixedTimeHHMM: newTimeHHMM,
      offsetBeforeSleepMinutes: -120,
      weekday: 0,
      insistIntervalMinutes: newInsistMin,
      insistDurationMinutes: 120,
      allowDiscreetMode: false,
    });
    setNewName('');
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (ruleSource === ruleTarget) return;
    const srcRoutine = routines.find((r) => r.id === ruleSource);
    onAddBlockingRule({
      id: `rule-${Date.now()}`,
      sourceRoutineId: ruleSource,
      targetRoutineId: ruleTarget,
      blockDurationHours: ruleHours,
      statusLabel: `omitido por ${srcRoutine?.name.toLowerCase() ?? ruleSource}`,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <header className="screen-header">
        <h1 className="screen-title">Rutinas</h1>
      </header>

      {routines.map((r) => {
        const displayTime = resolveRoutinePrimaryHHMM(r, settings);
        return (
          <div key={r.id} className="clock-card">
            <div className="clock-card-top">
              <div>
                <div className="time-huge">{displayTime}</div>
                <div className="routine-label">{r.name}</div>
                <div className="routine-subtext">
                  {r.scheduleType === 'relative_to_sleep' &&
                    `Dormir (${settings.sleepTimeHHMM}) − ${Math.abs(
                      (r.offsetBeforeSleepMinutes ?? -120) / 60
                    )} h`}
                  {r.scheduleType === 'fixed_daily' && 'Diaria (hora fija)'}
                  {r.scheduleType === 'weekly' &&
                    `Semanal (${WEEKDAYS_ES[r.weekday ?? 0]})`}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="routine-subtext">Activa</span>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) =>
                    onUpdateRoutine({ ...r, enabled: e.target.checked })
                  }
                />
              </label>
            </div>

            {r.scheduleType !== 'relative_to_sleep' && (
              <div className="form-row">
                <span className="routine-subtext">Hora principal</span>
                <input
                  type="time"
                  className="input-dark"
                  value={r.fixedTimeHHMM ?? '09:00'}
                  onChange={(e) =>
                    onUpdateRoutine({ ...r, fixedTimeHHMM: e.target.value })
                  }
                />
              </div>
            )}

            <div className="form-row">
              <span className="routine-subtext">Insistencia (minutos)</span>
              <input
                type="number"
                min={1}
                max={60}
                className="input-dark"
                style={{ width: 85 }}
                value={r.insistIntervalMinutes}
                onChange={(e) =>
                  onUpdateRoutine({
                    ...r,
                    insistIntervalMinutes: Math.max(1, Number(e.target.value) || 10),
                  })
                }
              />
            </div>

            <div className="form-row">
              <span className="routine-subtext">Modo discreto permitido</span>
              <button
                className={`chip-btn ${r.allowDiscreetMode ? 'active' : ''}`}
                onClick={() =>
                  onUpdateRoutine({
                    ...r,
                    allowDiscreetMode: !r.allowDiscreetMode,
                  })
                }
              >
                {r.allowDiscreetMode ? 'Permitir modo discreto' : 'Siempre alarma'}
              </button>
            </div>
          </div>
        );
      })}

      {/* Reglas de bloqueo configurables */}
      <div className="clock-card">
        <div className="routine-label">Reglas de bloqueo entre rutinas</div>
        {blockingRules.map((rule) => (
          <div key={rule.id} className="form-row">
            <div>
              <strong>{rule.sourceRoutineId}</strong> bloquea{' '}
              <strong>{rule.targetRoutineId}</strong> durante{' '}
              <span style={{ color: 'var(--accent)' }}>
                {rule.blockDurationHours} h exactas
              </span>
              <div className="routine-subtext">Estado: "{rule.statusLabel}"</div>
            </div>
            <button
              className="chip-btn"
              onClick={() => onDeleteBlockingRule(rule.id)}
            >
              Eliminar
            </button>
          </div>
        ))}

        <form
          onSubmit={handleCreateRule}
          style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}
        >
          <span className="routine-subtext">Añadir regla de bloqueo:</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="input-dark"
              value={ruleSource}
              onChange={(e) => setRuleSource(e.target.value)}
            >
              {routines.map((r) => (
                <option key={r.id} value={r.id}>
                  Al marcar: {r.name}
                </option>
              ))}
            </select>
            <select
              className="input-dark"
              value={ruleTarget}
              onChange={(e) => setRuleTarget(e.target.value)}
            >
              {routines.map((r) => (
                <option key={r.id} value={r.id}>
                  Bloquear: {r.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={168}
              className="input-dark"
              style={{ width: 90 }}
              value={ruleHours}
              onChange={(e) => setRuleHours(Number(e.target.value) || 24)}
            />
            <button type="submit" className="chip-btn active">
              + Regla ({ruleHours}h)
            </button>
          </div>
        </form>
      </div>

      {/* Añadir nueva rutina */}
      <form onSubmit={handleCreateRoutine} className="clock-card">
        <div className="routine-label">Añadir nueva tarea</div>
        <div className="form-row">
          <span className="routine-subtext">Nombre</span>
          <input
            type="text"
            placeholder="Ej. Vitamina D"
            className="input-dark"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div className="form-row">
          <span className="routine-subtext">Frecuencia</span>
          <select
            className="input-dark"
            value={newScheduleType}
            onChange={(e) => setNewScheduleType(e.target.value as ScheduleType)}
          >
            <option value="fixed_daily">Diaria (hora fija)</option>
            <option value="relative_to_sleep">Relativa a dormir (-2h)</option>
            <option value="weekly">Semanal</option>
          </select>
        </div>
        {newScheduleType !== 'relative_to_sleep' && (
          <div className="form-row">
            <span className="routine-subtext">Hora</span>
            <input
              type="time"
              className="input-dark"
              value={newTimeHHMM}
              onChange={(e) => setNewTimeHHMM(e.target.value)}
            />
          </div>
        )}
        <div className="form-row">
          <span className="routine-subtext">Insistir cada (min)</span>
          <input
            type="number"
            min={1}
            max={60}
            className="input-dark"
            style={{ width: 85 }}
            value={newInsistMin}
            onChange={(e) => setNewInsistMin(Number(e.target.value) || 10)}
          />
        </div>
        <button type="submit" className="btn-done-huge">
          + Guardar Rutina
        </button>
      </form>
    </div>
  );
};

// @end: Screen-Routines
