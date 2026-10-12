// @section: Routines-Configuration-Screen

import React, { useState } from 'react';
import { resolveRoutinePrimaryHHMM } from '../core/scheduler';
import type {
  BlockingRule,
  GlobalSettings,
  RoutineConfig,
  ScheduleType,
} from '../core/types';
import {
  BottomSheet,
  IOSSwitch,
  SegmentedControl,
  TimePickerSheet,
  WrapChoiceChips,
} from './CustomControls';
import { Icon } from './Icon';
import { getRoutineTheme } from './routineTheme';

const WEEKDAYS_ES = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

const WEEKDAYS_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

interface RoutinesScreenProps {
  routines: RoutineConfig[];
  blockingRules: BlockingRule[];
  settings: GlobalSettings;
  onUpdateRoutine: (updated: RoutineConfig) => void;
  onAddRoutine: (newRoutine: RoutineConfig) => void;
  onDeleteRoutine: (routineId: string) => void;
  onAddBlockingRule: (newRule: BlockingRule) => void;
  onUpdateBlockingRule: (updatedRule: BlockingRule) => void;
  onDeleteBlockingRule: (ruleId: string) => void;
}

export const RoutinesScreen: React.FC<RoutinesScreenProps> = ({
  routines,
  blockingRules,
  settings,
  onUpdateRoutine,
  onAddRoutine,
  onDeleteRoutine,
  onAddBlockingRule,
  onUpdateBlockingRule,
  onDeleteBlockingRule,
}) => {
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [confirmDeleteRoutineId, setConfirmDeleteRoutineId] = useState<string | null>(null);
  const [showAddRoutineSheet, setShowAddRoutineSheet] = useState(false);

  // Estado para edición o creación de regla de bloqueo en hoja inferior
  const [editingRule, setEditingRule] = useState<BlockingRule | null>(null);
  const [isNewRule, setIsNewRule] = useState(false);

  // Selector de hora en rueda (hoja inferior)
  const [timePickerConfig, setTimePickerConfig] = useState<{
    open: boolean;
    title: string;
    subtitle: string;
    initialHHMM: string;
    onSelect: (hhmm: string) => void;
  }>({
    open: false,
    title: '',
    subtitle: '',
    initialHHMM: '09:00',
    onSelect: () => {},
  });

  // Estado para nueva rutina en hoja inferior
  const [newName, setNewName] = useState('');
  const [newScheduleType, setNewScheduleType] =
    useState<ScheduleType>('fixed_daily');
  const [newTimeHHMM, setNewTimeHHMM] = useState('12:00');
  const [newWeekday, setNewWeekday] = useState<number>(0);
  const [newInsistMin, setNewInsistMin] = useState<'5' | '10' | '15' | '30'>(
    '10'
  );
  const [newAllowDiscreet, setNewAllowDiscreet] = useState<'alarm' | 'discreet'>(
    'alarm'
  );

  const editingRoutine =
    routines.find((r) => r.id === editingRoutineId) ?? null;

  const formatRoutineSummary = (r: RoutineConfig): string => {
    const primaryHHMM = resolveRoutinePrimaryHHMM(r, settings);
    if (r.scheduleType === 'relative_to_sleep') {
      const hours = Math.abs((r.offsetBeforeSleepMinutes ?? -120) / 60);
      return `${primaryHHMM} · Diaria (${hours} h antes de dormir)`;
    }
    if (r.scheduleType === 'weekly') {
      return `${primaryHHMM} · Semanal (${WEEKDAYS_ES[r.weekday ?? 0]})`;
    }
    if (r.secondarySchedule) {
      return `${primaryHHMM} y ${r.secondarySchedule.timeHHMM} · Diaria`;
    }
    return `${primaryHHMM} · Diaria`;
  };

  const handleCreateRoutine = () => {
    if (!newName.trim()) return;
    const slug = newName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    onAddRoutine({
      id: `${slug}-${Date.now().toString().slice(-3)}`,
      name: newName.trim(),
      enabled: true,
      scheduleType: newScheduleType,
      fixedTimeHHMM: newTimeHHMM,
      offsetBeforeSleepMinutes: -120,
      weekday: newWeekday,
      insistIntervalMinutes: Number(newInsistMin),
      insistDurationMinutes: 60,
      allowDiscreetMode: newAllowDiscreet === 'discreet',
    });
    setNewName('');
    setShowAddRoutineSheet(false);
  };

  const openNewBlockingRuleSheet = () => {
    const src = routines.find((r) => r.id === 'dermastamp') ?? routines[0];
    const tgt =
      routines.find((r) => r.id === 'minoxidil' && r.id !== src?.id) ??
      routines.find((r) => r.id !== src?.id) ??
      routines[0];
    setIsNewRule(true);
    setEditingRule({
      id: `rule-${Date.now()}`,
      sourceRoutineId: src?.id ?? 'dermastamp',
      targetRoutineId: tgt?.id ?? 'minoxidil',
      blockDurationHours: 24,
      statusLabel: `omitido por ${(src?.name ?? 'dermastamp').toLowerCase()}`,
    });
  };

  const handleSaveRuleSheet = () => {
    if (!editingRule) return;
    if (editingRule.sourceRoutineId === editingRule.targetRoutineId) {
      return;
    }
    const srcName =
      routines
        .find((r) => r.id === editingRule.sourceRoutineId)
        ?.name.toLowerCase() ?? editingRule.sourceRoutineId;
    const finalRule: BlockingRule = {
      ...editingRule,
      statusLabel: `omitido por ${srcName}`,
    };
    if (isNewRule) {
      onAddBlockingRule(finalRule);
    } else {
      onUpdateBlockingRule(finalRule);
    }
    setEditingRule(null);
  };

  return (
    <div className="bevel-today">
      <div className="bevel-screen-title-row">
        <h1 className="bevel-main-title">Rutinas</h1>
        <button
          type="button"
          className="circle-outline-btn"
          title="Añadir tarea"
          aria-label="Añadir tarea"
          onClick={() => setShowAddRoutineSheet(true)}
        >
          <Icon name="Plus" size={22} weight="bold" />
        </button>
      </div>

      {/* Lista de filas-tarjeta de rutinas */}
      <section className="bevel-routine-cards-stack" aria-label="Lista de rutinas">
        {routines.map((r) => {
          const theme = getRoutineTheme(r.id);
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              className={`bevel-routine-row-card interactive-row ${
                !r.enabled ? 'is-resolved' : ''
              }`}
              onClick={() => setEditingRoutineId(r.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingRoutineId(r.id);
                }
              }}
            >
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
                    <div className="bevel-routine-name">{r.name}</div>
                    <div className="bevel-routine-sub">
                      {formatRoutineSummary(r)}
                    </div>
                  </div>
                </div>

                <div
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <IOSSwitch
                    checked={r.enabled}
                    ariaLabel={`Activar ${r.name}`}
                    onChange={(checked) =>
                      onUpdateRoutine({ ...r, enabled: checked })
                    }
                  />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* Sección propia de Reglas de bloqueo con chips editables en hoja inferior */}
      <div className="bevel-section-header" style={{ marginTop: '6px' }}>
        <h2 className="bevel-section-title">Reglas de bloqueo</h2>
        <button
          type="button"
          className="circle-outline-btn"
          style={{ width: '42px', height: '42px' }}
          title="Añadir regla de bloqueo"
          onClick={openNewBlockingRuleSheet}
        >
          <Icon name="Plus" size={20} weight="bold" />
        </button>
      </div>

      <section
        className="bevel-routine-cards-stack"
        aria-label="Reglas de bloqueo entre rutinas"
      >
        {blockingRules.map((rule) => {
          const srcName =
            routines
              .find((r) => r.id === rule.sourceRoutineId)
              ?.name.toLowerCase() ?? rule.sourceRoutineId;
          const tgtName =
            routines
              .find((r) => r.id === rule.targetRoutineId)
              ?.name.toLowerCase() ?? rule.targetRoutineId;
          return (
            <button
              key={rule.id}
              type="button"
              className="bevel-rule-chip-card"
              onClick={() => {
                setIsNewRule(false);
                setEditingRule(rule);
              }}
            >
              <div className="chip-left-group">
                <div
                  className="chip-gradient-orb"
                  style={{
                    background:
                      'linear-gradient(180deg, #c4b5fd 0%, #7c3aed 100%)',
                    boxShadow:
                      '0 6px 14px rgba(124, 58, 237, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.38)',
                  }}
                >
                  <Icon
                    name="ShieldCheck"
                    size={22}
                    weight="fill"
                    color="#ffffff"
                  />
                </div>
                <div style={{ minWidth: 0, textAlign: 'left' }}>
                  <div className="bevel-routine-name" style={{ fontSize: '18px' }}>
                    {srcName} bloquea {tgtName} {rule.blockDurationHours} h
                  </div>
                  <div className="bevel-routine-sub" style={{ marginTop: '2px' }}>
                    Cancela alarmas en las {rule.blockDurationHours} h exactas tras
                    marcar
                  </div>
                </div>
              </div>
              <Icon
                name="CaretRight"
                size={20}
                weight="bold"
                color="var(--text-secondary)"
              />
            </button>
          );
        })}
      </section>

      {/* Hoja inferior para editar rutina seleccionada */}
      <BottomSheet
        open={Boolean(editingRoutine)}
        title={editingRoutine?.name ?? 'Editar rutina'}
        subtitle="Configuración de horario, insistencia y modo de aviso"
        onClose={() => {
          setConfirmDeleteRoutineId(null);
          setEditingRoutineId(null);
        }}
      >
        {editingRoutine && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Horario: Minoxidil muestra hora derivada no editable; el resto usa TimePickerSheet */}
            {editingRoutine.scheduleType === 'relative_to_sleep' ? (
              <div className="sheet-group-box">
                <div className="sheet-row-between">
                  <div>
                    <div className="sheet-field-label">Hora calculada</div>
                    <div className="sheet-field-sub">
                      Hora de dormir ({settings.sleepTimeHHMM}) − 2 h (no editable)
                    </div>
                  </div>
                  <span className="derived-time-badge">
                    {resolveRoutinePrimaryHHMM(editingRoutine, settings)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="sheet-group-box">
                {editingRoutine.scheduleType === 'weekly' && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      paddingBottom: '12px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div className="sheet-field-label">Día de la semana</div>
                    <div className="weekday-pills-row">
                      {WEEKDAYS_SHORT.map((letter, idx) => {
                        const active = (editingRoutine.weekday ?? 0) === idx;
                        return (
                          <button
                            key={letter + idx}
                            type="button"
                            className={`weekday-circle-pill ${
                              active ? 'active' : ''
                            }`}
                            onClick={() =>
                              onUpdateRoutine({
                                ...editingRoutine,
                                weekday: idx,
                              })
                            }
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="sheet-row-between">
                  <div>
                    <div className="sheet-field-label">
                      {editingRoutine.secondarySchedule
                        ? 'Alarma de mañana'
                        : 'Hora de alarma'}
                    </div>
                    <div className="sheet-field-sub">
                      Toca para abrir el selector de rueda
                    </div>
                  </div>
                  <button
                    type="button"
                    className="time-trigger-pill"
                    onClick={() =>
                      setTimePickerConfig({
                        open: true,
                        title: `Hora · ${editingRoutine.name}`,
                        subtitle: 'Selecciona la hora principal',
                        initialHHMM: editingRoutine.fixedTimeHHMM ?? '09:00',
                        onSelect: (hhmm) =>
                          onUpdateRoutine({
                            ...editingRoutine,
                            fixedTimeHHMM: hhmm,
                          }),
                      })
                    }
                  >
                    <Icon name="Clock" size={18} weight="bold" />
                    <span>{editingRoutine.fixedTimeHHMM ?? '09:00'}</span>
                  </button>
                </div>

                {editingRoutine.secondarySchedule && (
                  <div
                    className="sheet-row-between"
                    style={{
                      paddingTop: '12px',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div>
                      <div className="sheet-field-label">2º aviso de tarde</div>
                      <div className="sheet-field-sub">
                        Si no se marcó por la mañana (+1 h con "No estoy en casa")
                      </div>
                    </div>
                    <button
                      type="button"
                      className="time-trigger-pill"
                      onClick={() =>
                        setTimePickerConfig({
                          open: true,
                          title: `2º aviso · ${editingRoutine.name}`,
                          subtitle: 'Selecciona la hora del aviso de tarde',
                          initialHHMM:
                            editingRoutine.secondarySchedule?.timeHHMM ??
                            '15:30',
                          onSelect: (hhmm) =>
                            onUpdateRoutine({
                              ...editingRoutine,
                              secondarySchedule: editingRoutine.secondarySchedule
                                ? {
                                    ...editingRoutine.secondarySchedule,
                                    timeHHMM: hhmm,
                                  }
                                : undefined,
                            }),
                        })
                      }
                    >
                      <Icon name="Clock" size={18} weight="bold" />
                      <span>
                        {editingRoutine.secondarySchedule.timeHHMM}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Insistencia */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="sheet-field-label">Insistencia entre avisos</div>
              <SegmentedControl<'5' | '10' | '15' | '30'>
                options={[
                  { value: '5', label: '5 min' },
                  { value: '10', label: '10 min' },
                  { value: '15', label: '15 min' },
                  { value: '30', label: '30 min' },
                ]}
                value={
                  (['5', '10', '15', '30'].includes(
                    String(editingRoutine.insistIntervalMinutes)
                  )
                    ? String(editingRoutine.insistIntervalMinutes)
                    : '10') as '5' | '10' | '15' | '30'
                }
                onChange={(val) =>
                  onUpdateRoutine({
                    ...editingRoutine,
                    insistIntervalMinutes: Number(val),
                  })
                }
              />
            </div>

            {/* Comportamiento en Modo Discreto */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="sheet-field-label">Modo de aviso permitido</div>
              <SegmentedControl<'alarm' | 'discreet'>
                options={[
                  { value: 'alarm', label: 'Siempre alarma' },
                  { value: 'discreet', label: 'Modo discreto' },
                ]}
                value={editingRoutine.allowDiscreetMode ? 'discreet' : 'alarm'}
                onChange={(val) =>
                  onUpdateRoutine({
                    ...editingRoutine,
                    allowDiscreetMode: val === 'discreet',
                  })
                }
              />
            </div>

            {confirmDeleteRoutineId === editingRoutine.id ? (
              <div className="confirm-inline-box" role="alertdialog" aria-label="Confirmar eliminación de rutina">
                <div className="confirm-inline-text">
                  ¿Eliminar «{editingRoutine.name}»? Se cancelarán todas sus alarmas y se borrarán las reglas de bloqueo que la referencian. Su historial pasado se conservará con su nombre.
                </div>
                <div className="confirm-inline-actions">
                  <button
                    type="button"
                    className="bevel-row-action-pill"
                    onClick={() => setConfirmDeleteRoutineId(null)}
                  >
                    <span>Cancelar</span>
                  </button>
                  <button
                    type="button"
                    className="danger-action-btn"
                    onClick={() => {
                      onDeleteRoutine(editingRoutine.id);
                      setConfirmDeleteRoutineId(null);
                      setEditingRoutineId(null);
                    }}
                  >
                    <Icon name="Trash" size={18} weight="bold" color="#fca5a5" />
                    <span>Sí, eliminar rutina</span>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="danger-action-btn"
                onClick={() => setConfirmDeleteRoutineId(editingRoutine.id)}
              >
                <Icon name="Trash" size={18} weight="bold" color="#fca5a5" />
                <span>Eliminar rutina</span>
              </button>
            )}

            <button
              type="button"
              className="primary-action-btn"
              onClick={() => {
                setConfirmDeleteRoutineId(null);
                setEditingRoutineId(null);
              }}
            >
              <Icon name="Check" size={20} weight="bold" />
              <span>Listo</span>
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Hoja inferior para añadir nueva tarea */}
      <BottomSheet
        open={showAddRoutineSheet}
        title="Nueva tarea"
        subtitle="Define su nombre, frecuencia e insistencia"
        onClose={() => setShowAddRoutineSheet(false)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="sheet-field-label">Nombre de la rutina</div>
            <input
              type="text"
              placeholder="Ej. Vitamina D"
              className="input-dark"
              style={{ width: '100%' }}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="sheet-field-label">Frecuencia</div>
            <SegmentedControl<ScheduleType>
              options={[
                { value: 'fixed_daily', label: 'Diaria' },
                { value: 'weekly', label: 'Semanal' },
                { value: 'relative_to_sleep', label: 'Dormir − 2h' },
              ]}
              value={newScheduleType}
              onChange={setNewScheduleType}
            />
          </div>

          {newScheduleType === 'weekly' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="sheet-field-label">Día de la semana</div>
              <div className="weekday-pills-row">
                {WEEKDAYS_SHORT.map((letter, idx) => (
                  <button
                    key={letter + idx}
                    type="button"
                    className={`weekday-circle-pill ${
                      newWeekday === idx ? 'active' : ''
                    }`}
                    onClick={() => setNewWeekday(idx)}
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {newScheduleType !== 'relative_to_sleep' && (
            <div className="sheet-group-box">
              <div className="sheet-row-between">
                <div className="sheet-field-label">Hora de alarma</div>
                <button
                  type="button"
                  className="time-trigger-pill"
                  onClick={() =>
                    setTimePickerConfig({
                      open: true,
                      title: 'Hora de la nueva tarea',
                      subtitle: 'Selecciona la hora en la rueda',
                      initialHHMM: newTimeHHMM,
                      onSelect: (hhmm) => setNewTimeHHMM(hhmm),
                    })
                  }
                >
                  <Icon name="Clock" size={18} weight="bold" />
                  <span>{newTimeHHMM}</span>
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="sheet-field-label">Insistencia</div>
            <SegmentedControl<'5' | '10' | '15' | '30'>
              options={[
                { value: '5', label: '5 min' },
                { value: '10', label: '10 min' },
                { value: '15', label: '15 min' },
                { value: '30', label: '30 min' },
              ]}
              value={newInsistMin}
              onChange={setNewInsistMin}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div className="sheet-field-label">Modo permitido</div>
            <SegmentedControl<'alarm' | 'discreet'>
              options={[
                { value: 'alarm', label: 'Siempre alarma' },
                { value: 'discreet', label: 'Modo discreto' },
              ]}
              value={newAllowDiscreet}
              onChange={setNewAllowDiscreet}
            />
          </div>

          <button
            type="button"
            className="primary-action-btn"
            onClick={handleCreateRoutine}
          >
            <Icon name="Check" size={20} weight="bold" />
            <span>Guardar tarea</span>
          </button>
        </div>
      </BottomSheet>

      {/* Hoja inferior para editar o crear regla de bloqueo */}
      <BottomSheet
        open={Boolean(editingRule)}
        title={isNewRule ? 'Nueva regla de bloqueo' : 'Editar regla de bloqueo'}
        subtitle="Cancela automáticamente las alarmas dentro de la ventana"
        onClose={() => setEditingRule(null)}
      >
        {editingRule && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="sheet-field-label">Al completar la tarea</div>
              <WrapChoiceChips<string>
                ariaLabel="Seleccionar tarea que activa el bloqueo"
                options={routines.map((r) => ({
                  value: r.id,
                  label: r.name,
                }))}
                value={editingRule.sourceRoutineId}
                onChange={(val) =>
                  setEditingRule({ ...editingRule, sourceRoutineId: val })
                }
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="sheet-field-label">Bloquear tarea</div>
              <WrapChoiceChips<string>
                ariaLabel="Seleccionar tarea a bloquear"
                options={routines.map((r) => ({
                  value: r.id,
                  label: r.name,
                }))}
                value={editingRule.targetRoutineId}
                onChange={(val) =>
                  setEditingRule({ ...editingRule, targetRoutineId: val })
                }
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="sheet-field-label">Duración exacta del bloqueo</div>
              <SegmentedControl<'12' | '24' | '36' | '48'>
                options={[
                  { value: '12', label: '12 h' },
                  { value: '24', label: '24 h' },
                  { value: '36', label: '36 h' },
                  { value: '48', label: '48 h' },
                ]}
                value={
                  (['12', '24', '36', '48'].includes(
                    String(editingRule.blockDurationHours)
                  )
                    ? String(editingRule.blockDurationHours)
                    : '24') as '12' | '24' | '36' | '48'
                }
                onChange={(val) =>
                  setEditingRule({
                    ...editingRule,
                    blockDurationHours: Number(val),
                  })
                }
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              {!isNewRule && (
                <button
                  type="button"
                  className="bevel-row-action-pill"
                  style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.28)' }}
                  onClick={() => {
                    onDeleteBlockingRule(editingRule.id);
                    setEditingRule(null);
                  }}
                >
                  <Icon name="Trash" size={18} weight="bold" color="#f87171" />
                  <span>Eliminar</span>
                </button>
              )}
              <button
                type="button"
                className="primary-action-btn"
                style={{ flex: 1 }}
                onClick={handleSaveRuleSheet}
              >
                <Icon name="Check" size={20} weight="bold" />
                <span>Guardar regla</span>
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Selector de hora propio en rueda */}
      <TimePickerSheet
        open={timePickerConfig.open}
        title={timePickerConfig.title}
        subtitle={timePickerConfig.subtitle}
        initialHHMM={timePickerConfig.initialHHMM}
        onClose={() => setTimePickerConfig((prev) => ({ ...prev, open: false }))}
        onConfirm={timePickerConfig.onSelect}
      />
    </div>
  );
};

// @end: Routines-Configuration-Screen
