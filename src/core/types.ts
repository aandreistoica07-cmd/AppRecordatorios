// @section: Core-Types

export type ScheduleType = 'relative_to_sleep' | 'fixed_daily' | 'weekly';

export interface ChecklistStep {
  id: string;
  label: string;
}

export interface SecondaryScheduleConfig {
  timeHHMM: string; // ej. '15:30'
  insistIntervalMinutes: number; // ej. 10
  insistDurationMinutes: number; // ej. 180
  allowNotAtHomePostpone: boolean;
  postponeDurationMinutes: number; // ej. 60 (1 hora)
  maxPostponeTimeHHMM: string; // ej. '22:00'
}

export interface RoutineConfig {
  id: string;
  name: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  /** Usado si scheduleType === 'relative_to_sleep' (ej. -120 para dormir - 2h) */
  offsetBeforeSleepMinutes?: number;
  /** Usado si scheduleType === 'fixed_daily' o 'weekly' (ej. '09:00') */
  fixedTimeHHMM?: string;
  /** Usado si scheduleType === 'weekly' (0 = Domingo, 1 = Lunes, ..., 6 = Sábado) */
  weekday?: number;
  /** Intervalo de insistencia en minutos en modo alarma (ej. 10) */
  insistIntervalMinutes: number;
  /** Duración máxima de insistencia en minutos (ej. 60 para pastilla mañana, 180 para otras) */
  insistDurationMinutes: number;
  /** Segundo aviso opcional en el día si no se ha marcado como hecha (ej. Pastilla tarde 15:30) */
  secondarySchedule?: SecondaryScheduleConfig;
  /** Pasos secuenciales obligatorios antes de poder marcar Hecho (ej. Dermastamp) */
  checklistSteps?: { id: string; label: string }[];
  /** Si es false (por defecto), siempre usa alarma aunque el modo discreto esté activo */
  allowDiscreetMode: boolean;
}

export interface BlockingRule {
  id: string;
  sourceRoutineId: string; // ej. 'dermastamp'
  targetRoutineId: string; // ej. 'minoxidil'
  blockDurationHours: number; // ej. 24 (24 horas exactas desde completedAtISO)
  statusLabel: string; // ej. 'omitido por dermastamp'
}

export type DayRoutineStatus =
  | 'pending'
  | 'completed'
  | 'skipped'
  | 'omitted_by_block';

export interface RoutineDayRecord {
  routineId: string;
  /** Fecha lógica de la rutina en formato YYYY-MM-DD */
  dateKey: string;
  status: DayRoutineStatus;
  /** ISO timestamp exacto de cuando se marcó como completada */
  completedAtISO?: string;
  /** Pasos del checklist completados en ese día */
  completedChecklistSteps?: string[];
  /** Número de veces que se ha pulsado "No estoy en casa" en ese día */
  notAtHomePostponeCount?: number;
  /** Hora desplazada actual del aviso de tarde tras pulsar "No estoy en casa" (formato HH:MM) */
  postponedAfternoonTimeHHMM?: string;
  /** Razón si fue omitida por regla de bloqueo */
  blockReason?: string;
  /** ID de la rutina origen que causó el bloqueo */
  blockedByRoutineId?: string;
}

export type ActiveNoticeMode =
  | { type: 'alarm' }
  | {
      type: 'discreet';
      startedAtISO: string;
      untilISO: string;
      discreetIntervalMinutes: number; // ej. 3 minutos
    }
  | {
      type: 'paused';
      startedAtISO: string;
      untilISO: string;
      targetHHMM: string;
    };

export interface GlobalSettings {
  sleepTimeHHMM: string; // Por defecto '00:00'
  pillMorningTimeHHMM: string; // Por defecto '09:00'
  pillAfternoonTimeHHMM: string; // Por defecto '15:30'
  dermastampWeekday: number; // 0-6 (Por defecto 0 = Domingo)
  dermastampTimeHHMM: string; // Por defecto '20:00'
  useTimeSensitiveEntitlement: boolean; // Por defecto false para Apple ID gratuito
}

export type PromptDeliveryChannel = 'alarmkit' | 'local_notification';

export type PromptKind =
  | 'primary'
  | 'insistence'
  | 'secondary_primary'
  | 'secondary_insistence'
  | 'pause_recovery';

export interface ScheduledPrompt {
  /** ID determinista legible: routineId__dateKey__kind__index */
  deterministicId: string;
  /** Hash entero 32-bit positivo determinista para @capacitor/local-notifications */
  notificationNumericId: number;
  /** UUID v5/determinista en formato 8-4-4-4-12 para AlarmKit */
  alarmUuid: string;
  routineId: string;
  routineName: string;
  dateKey: string;
  scheduledAtISO: string;
  kind: PromptKind;
  channel: PromptDeliveryChannel;
  /** Si está bloqueada por una regla (ej. dermastamp 24h), se incluye en la vista con blocked=true pero NO se envía al sistema */
  blocked: boolean;
  blockedReason?: string;
  blockedByCompletedAtISO?: string;
  /** Botones de acción asociados al aviso */
  actions: ('DONE' | 'NOT_AT_HOME')[];
}

export interface ScheduleComputationResult {
  /** Todos los eventos principales de los próximos 7 días (incluyendo bloqueados para mostrar en "Próximas alarmas") */
  upcomingSevenDaysOverview: ScheduledPrompt[];
  /** Lista exacta de avisos activos (principales + ráfagas de insistencia + recuperación de pausa) listos para programar en iOS respetando límites del sistema */
  activePromptsToSchedule: ScheduledPrompt[];
  /** Registros de día auto-generados como 'omitted_by_block' cuando una alarma cae dentro de las 24h exactas posteriores al dermastamp */
  autoOmittedRecords: RoutineDayRecord[];
  /** Estado efectivo del modo evaluado en `now` (si el modo discreto o pausa ya caducó, vuelve a `{ type: 'alarm' }`) */
  effectiveMode: ActiveNoticeMode;
}

// @end: Core-Types
