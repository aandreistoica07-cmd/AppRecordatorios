// @section: Scheduler-Time-Helpers

import {
  buildDeterministicStringId,
  toDeterministicNumericId,
  toDeterministicUuid,
} from './idGenerator';
import type {
  ActiveNoticeMode,
  BlockingRule,
  GlobalSettings,
  NotificationActionId,
  PromptDeliveryChannel,
  PromptKind,
  RoutineConfig,
  RoutineDayRecord,
  ScheduleComputationResult,
  ScheduledPrompt,
} from './types';

/** Límite máximo de notificaciones locales que permite iOS (64). Usamos 60 por margen de seguridad. */
export const IOS_MAX_PENDING_NOTIFICATIONS = 60;

/** Límite por defecto de avisos de insistencia por ráfaga tras el aviso principal. */
export const DEFAULT_MAX_INSISTENCE_COUNT = 6;

/**
 * Tratamiento del cambio de hora DST (ej. domingo 25 de octubre de 2026 en Europe/Madrid, día de 25 horas):
 * 1. Alarmas por hora local del reloj (Wall-Clock Time):
 *    `buildDateFromKeyAndHHMM(dateKey, hhmm)` construye `new Date(year, monthIndex, day, hours, minutes, 0, 0)`
 *    en la zona horaria local del dispositivo. Así, una alarma fijada a las 09:00, 15:30, 20:00 o 22:00 del
 *    25 de octubre de 2026 suena exactamente a esa hora del reloj civil (ya en horario CET UTC+1).
 *    Los desplazamientos de fecha (`addDaysToDateKey`) se calculan al mediodía local (12:00) mediante `setDate`,
 *    evitando desfases cuando un día civil dura 23 o 25 horas.
 * 2. Ventanas de bloqueo y duraciones (+1h, +2h, +4h, 24h de dermastamp) por horas reales transcurridas (Elapsed Real Time):
 *    Las ventanas de bloqueo (`blockDurationHours * 3_600_000` ms) y posposiciones por duración operan sobre
 *    timestamps UTC (`Date.getTime()`), contando horas físicas reales transcurridas (por ejemplo, 24 h reales
 *    desde el sábado 24/10 a las 21:30 CEST concluyen el domingo 25/10 a las 20:30 CET al existir una hora extra).
 */

export function parseHHMM(hhmm: string): { hours: number; minutes: number } {
  const [hStr, mStr] = hhmm.split(':');
  const hours = Math.max(0, Math.min(23, Number(hStr) || 0));
  const minutes = Math.max(0, Math.min(59, Number(mStr) || 0));
  return { hours, minutes };
}

export function formatHHMM(hours: number, minutes: number): string {
  const h = ((hours % 24) + 24) % 24;
  const m = ((minutes % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildDateFromKeyAndHHMM(dateKey: string, hhmm: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const { hours, minutes } = parseHHMM(hhmm);
  return new Date(y, m - 1, d, hours, minutes, 0, 0);
}

export function addDaysToDateKey(dateKey: string, daysToAdd: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + daysToAdd);
  return formatDateKey(dt);
}

export function getWeekdayFromDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getDay();
}

/**
 * Calcula la hora objetivo ("HH:MM") de una rutina según su configuración y la hora de dormir global.
 * Ejemplo:
 * - sleepTimeHHMM = "00:00", offset = -120 -> "22:00"
 * - sleepTimeHHMM = "02:00", offset = -120 -> "00:00"
 * - sleepTimeHHMM = "23:00", offset = -120 -> "21:00"
 */
export function resolveRoutinePrimaryHHMM(
  routine: RoutineConfig,
  settings: GlobalSettings
): string {
  if (routine.scheduleType === 'relative_to_sleep') {
    const { hours, minutes } = parseHHMM(settings.sleepTimeHHMM);
    const offset = routine.offsetBeforeSleepMinutes ?? -120;
    const totalMinutes = ((hours * 60 + minutes + offset) % 1440 + 1440) % 1440;
    const targetH = Math.floor(totalMinutes / 60);
    const targetM = totalMinutes % 60;
    return formatHHMM(targetH, targetM);
  }
  return routine.fixedTimeHHMM ?? '09:00';
}

/**
 * Calcula el instante exacto del tope de la hora de dormir (`sleepTimeHHMM`) para una jornada `dateKey`.
 * Si la hora de dormir es de madrugada (00:00..11:59, como el valor por defecto "00:00" o "02:00")
 * o es anterior/igual a la hora base de la rutina en ese día, corresponde al cierre nocturno de esa jornada
 * (en la fecha civil `addDaysToDateKey(dateKey, 1)` a la hora local `sleepTimeHHMM`).
 */
export function resolveSleepCapDate(
  dateKey: string,
  settings: GlobalSettings,
  referenceDate?: Date
): Date {
  const { hours } = parseHHMM(settings.sleepTimeHHMM);
  const sameDayCandidate = buildDateFromKeyAndHHMM(
    dateKey,
    settings.sleepTimeHHMM
  );
  if (
    hours < 12 ||
    (referenceDate && sameDayCandidate.getTime() < referenceDate.getTime())
  ) {
    const nextDayKey = addDaysToDateKey(dateKey, 1);
    return buildDateFromKeyAndHHMM(nextDayKey, settings.sleepTimeHHMM);
  }
  return sameDayCandidate;
}

/**
 * Construye el Date exacto de la alarma principal de una rutina para su `dateKey`.
 * Si el registro diario tiene una posposición activa (`postponedPrimaryAtISO` o `postponedPrimaryTimeHHMM`),
 * devuelve la fecha/hora pospuesta para cancelar las insistencias previas y reprogramar desde esa nueva hora.
 */
export function resolveRoutinePrimaryDate(
  routine: RoutineConfig,
  dateKey: string,
  settings: GlobalSettings,
  existingRecord?: RoutineDayRecord
): Date {
  const baseHHMM = resolveRoutinePrimaryHHMM(routine, settings);
  const baseDate = buildDateFromKeyAndHHMM(dateKey, baseHHMM);

  if (existingRecord?.postponedPrimaryAtISO) {
    const parsedMs = new Date(existingRecord.postponedPrimaryAtISO).getTime();
    if (!Number.isNaN(parsedMs)) {
      return new Date(parsedMs);
    }
  }

  if (existingRecord?.postponedPrimaryTimeHHMM) {
    const candidate = buildDateFromKeyAndHHMM(
      dateKey,
      existingRecord.postponedPrimaryTimeHHMM
    );
    if (candidate.getTime() < baseDate.getTime()) {
      return buildDateFromKeyAndHHMM(
        addDaysToDateKey(dateKey, 1),
        existingRecord.postponedPrimaryTimeHHMM
      );
    }
    return candidate;
  }

  return baseDate;
}

/**
 * Determina si una rutina aplica en un `dateKey` determinado.
 */
export function doesRoutineApplyOnDate(
  routine: RoutineConfig,
  dateKey: string
): boolean {
  if (!routine.enabled) return false;
  if (routine.scheduleType === 'weekly') {
    const weekday = getWeekdayFromDateKey(dateKey);
    return weekday === (routine.weekday ?? 0);
  }
  return true;
}

// @end: Scheduler-Time-Helpers

// @section: Scheduler-Checklist-And-Postpone

/**
 * Valida y aplica el marcado de un paso de checklist (ej. Dermastamp: paso 1 desinfectar, paso 2 aplicado).
 * El paso 2 SOLO se puede completar si el paso 1 ya está completado.
 */
export function toggleChecklistStep(
  routine: RoutineConfig,
  existingRecord: RoutineDayRecord | undefined,
  dateKey: string,
  stepId: string,
  now: Date
): { record: RoutineDayRecord; error?: string } {
  const steps = routine.checklistSteps ?? [];
  const stepIndex = steps.findIndex((s) => s.id === stepId);
  const baseRecord: RoutineDayRecord = existingRecord
    ? {
        ...existingRecord,
        routineName: routine.name,
        completedChecklistSteps: [...(existingRecord.completedChecklistSteps ?? [])],
      }
    : {
        routineId: routine.id,
        routineName: routine.name,
        dateKey,
        status: 'pending',
        completedChecklistSteps: [],
      };

  if (stepIndex === -1) {
    return { record: baseRecord, error: 'Paso no encontrado' };
  }

  const completedSet = new Set(baseRecord.completedChecklistSteps ?? []);

  if (completedSet.has(stepId)) {
    // Si desmarca un paso anterior, también desmarca los posteriores
    for (let i = stepIndex; i < steps.length; i++) {
      completedSet.delete(steps[i].id);
    }
    baseRecord.completedChecklistSteps = Array.from(completedSet);
    baseRecord.status = 'pending';
    delete baseRecord.completedAtISO;
    return { record: baseRecord };
  }

  // Verificar que todos los pasos previos (0 .. stepIndex - 1) estén completados
  for (let i = 0; i < stepIndex; i++) {
    if (!completedSet.has(steps[i].id)) {
      return {
        record: baseRecord,
        error: `Debes completar primero: "${steps[i].label}"`,
      };
    }
  }

  completedSet.add(stepId);
  baseRecord.completedChecklistSteps = Array.from(completedSet);

  // Si se completaron todos los pasos del checklist, la rutina pasa a 'completed'
  const allCompleted = steps.every((s) => completedSet.has(s.id));
  if (allCompleted) {
    baseRecord.status = 'completed';
    baseRecord.completedAtISO = now.toISOString();
  }

  return { record: baseRecord };
}

/**
 * Marca una rutina directamente como "Hecho" en `now`.
 * Si tiene checklist obligatorio y aún no se ha completado el paso 1, exige el paso previo salvo que `forceAllSteps` sea false.
 */
export function markRoutineDone(
  routine: RoutineConfig,
  existingRecord: RoutineDayRecord | undefined,
  dateKey: string,
  now: Date
): { record: RoutineDayRecord; error?: string } {
  if (routine.checklistSteps && routine.checklistSteps.length > 0) {
    const completed = existingRecord?.completedChecklistSteps ?? [];
    const firstUncompleted = routine.checklistSteps.find(
      (s) => !completed.includes(s.id)
    );
    if (firstUncompleted && firstUncompleted.id !== routine.checklistSteps[routine.checklistSteps.length - 1].id) {
      return {
        record:
          existingRecord ?? {
            routineId: routine.id,
            routineName: routine.name,
            dateKey,
            status: 'pending',
            completedChecklistSteps: [],
          },
        error: `Debes completar primero: "${firstUncompleted.label}"`,
      };
    }
  }

  return {
    record: {
      ...(existingRecord ?? {}),
      routineId: routine.id,
      routineName: routine.name,
      dateKey,
      status: 'completed',
      completedAtISO: now.toISOString(),
      completedChecklistSteps: routine.checklistSteps
        ? routine.checklistSteps.map((s) => s.id)
        : existingRecord?.completedChecklistSteps,
    },
  };
}

/**
 * Deshace una tarea completada en `dateKey`:
 * - La tarea vuelve a `'pending'`, limpiando `completedAtISO` y pasos del checklist.
 * - Si la tarea tenía reglas de bloqueo activas (ej. Dermastamp -> Minoxidil 24 h),
 *   recalcula el bloqueo y restaura a `'pending'` cualquier tarea que se hubiera omitido
 *   dentro de la ventana de 24 h y que ya no esté bloqueada.
 */
export function unmarkRoutineDone(
  routineId: string,
  dateKey: string,
  records: RoutineDayRecord[],
  routines: RoutineConfig[],
  blockingRules: BlockingRule[],
  settings: GlobalSettings
): RoutineDayRecord[] {
  const routine = routines.find((r) => r.id === routineId);

  // 1. Revertir el registro objetivo a 'pending' (conservando posposiciones previas si las hubiera)
  const stepOneRecords: RoutineDayRecord[] = [];
  for (const rec of records) {
    if (rec.routineId === routineId && rec.dateKey === dateKey) {
      const reverted: RoutineDayRecord = {
        routineId: rec.routineId,
        routineName: rec.routineName ?? routine?.name,
        dateKey: rec.dateKey,
        status: 'pending',
      };
      if (rec.postponeCount !== undefined) {
        reverted.postponeCount = rec.postponeCount;
      }
      if (rec.postponedPrimaryTimeHHMM !== undefined) {
        reverted.postponedPrimaryTimeHHMM = rec.postponedPrimaryTimeHHMM;
      }
      if (rec.postponedPrimaryAtISO !== undefined) {
        reverted.postponedPrimaryAtISO = rec.postponedPrimaryAtISO;
      }
      if (rec.notAtHomePostponeCount !== undefined) {
        reverted.notAtHomePostponeCount = rec.notAtHomePostponeCount;
      }
      if (rec.postponedAfternoonTimeHHMM !== undefined) {
        reverted.postponedAfternoonTimeHHMM = rec.postponedAfternoonTimeHHMM;
      }
      if (routine?.checklistSteps && routine.checklistSteps.length > 0) {
        reverted.completedChecklistSteps = [];
      }
      stepOneRecords.push(reverted);
    } else {
      stepOneRecords.push({ ...rec });
    }
  }

  // 2. Recalcular bloqueos: cualquier registro 'omitted_by_block' que dependiera de esta rutina
  //    y ya no caiga dentro de una ventana de 24h activa vuelve a estar 'pending' (se elimina el estado omitido).
  const finalRecords: RoutineDayRecord[] = [];
  for (const rec of stepOneRecords) {
    if (rec.status === 'omitted_by_block') {
      const targetRoutine = routines.find((r) => r.id === rec.routineId);
      if (targetRoutine) {
        const primaryDate = resolveRoutinePrimaryDate(
          targetRoutine,
          rec.dateKey,
          settings,
          rec
        );
        const blockCheck = findActiveBlockForTimestamp(
          targetRoutine.id,
          primaryDate,
          blockingRules,
          stepOneRecords
        );
        if (!blockCheck.blocked) {
          // Vuelve a estar pendiente
          continue;
        }
      } else if (rec.blockedByRoutineId === routineId) {
        continue;
      }
    }
    finalRecords.push(rec);
  }

  return finalRecords;
}

/**
 * Elimina una rutina por ID:
 * - Devuelve la lista de rutinas sin ella.
 * - Borra todas las reglas de bloqueo que la referencian (como origen o destino).
 * - Conserva su historial pasado en `records` guardando `routineName` para que Historial muestre su nombre.
 * - Restaura a pendiente cualquier bloqueo futuro/actual que dependiera de la rutina eliminada.
 * - Devuelve los IDs numéricos de notificaciones asociadas para su cancelación explícita.
 */
export function deleteRoutineAndCleanup(params: {
  routineId: string;
  todayKey: string;
  routines: RoutineConfig[];
  blockingRules: BlockingRule[];
  records: RoutineDayRecord[];
  activePrompts?: ScheduledPrompt[];
}): {
  routines: RoutineConfig[];
  blockingRules: BlockingRule[];
  records: RoutineDayRecord[];
  cancelledNumericIds: number[];
} {
  const {
    routineId,
    todayKey,
    routines,
    blockingRules,
    records,
    activePrompts = [],
  } = params;

  const targetRoutine = routines.find((r) => r.id === routineId);
  const savedName = targetRoutine?.name ?? routineId;

  const nextRoutines = routines.filter((r) => r.id !== routineId);
  const nextBlockingRules = blockingRules.filter(
    (rule) =>
      rule.sourceRoutineId !== routineId && rule.targetRoutineId !== routineId
  );

  const nextRecords: RoutineDayRecord[] = [];
  for (const rec of records) {
    if (rec.routineId === routineId) {
      // Conservar historial pasado o registros completados/omitidos/saltados con el nombre guardado
      if (rec.status !== 'pending') {
        nextRecords.push({
          ...rec,
          routineName: rec.routineName ?? savedName,
        });
      }
      continue;
    }

    // Si otra rutina estaba omitida hoy o en el futuro por la rutina eliminada, vuelve a pendiente
    if (
      rec.status === 'omitted_by_block' &&
      rec.blockedByRoutineId === routineId &&
      rec.dateKey >= todayKey
    ) {
      continue;
    }

    nextRecords.push(rec);
  }

  const cancelledNumericIds = activePrompts
    .filter(
      (p) =>
        p.routineId === routineId ||
        p.routineId.split(',').includes(routineId)
    )
    .map((p) => p.notificationNumericId);

  return {
    routines: nextRoutines,
    blockingRules: nextBlockingRules,
    records: nextRecords,
    cancelledNumericIds,
  };
}

export type PostponeTaskInputMode =
  | { type: 'duration'; durationMinutes: number }
  | { type: 'add_hours'; hours: number }
  | { type: 'until_time'; targetHHMM: string };

/**
 * Posponer por tarea (sirve para cualquier rutina: minoxidil, pastilla de mañana o tarde, dermastamp y nuevas):
 * - Cancela sus insistencias previas al desplazar la hora del aviso (`postponedPrimaryAtISO` / `postponedPrimaryTimeHHMM`).
 * - Soporta posponer por duración (+1 h, +2 h, +4 h) o hasta una hora concreta (`targetHHMM`).
 * - Si la rutina tiene segundo horario (ej. Pastilla de la tarde a las 15:30) y se pospone en la tarde
 *   o sobre un registro con `postponedAfternoonTimeHHMM` previo, parte de ese horario de tarde y aplica el mismo tope de la hora de dormir.
 * - Aplica tope máximo en la hora de dormir global (`settings.sleepTimeHHMM`).
 */
export function postponeRoutineTask(params: {
  routine: RoutineConfig;
  existingRecord: RoutineDayRecord | undefined;
  dateKey: string;
  settings: GlobalSettings;
  mode?: PostponeTaskInputMode;
  now?: Date;
}): {
  record: RoutineDayRecord;
  reachedCap: boolean;
  nextTimeHHMM: string;
  nextDateISO: string;
  sleepCapHHMM: string;
} {
  const {
    routine,
    existingRecord,
    dateKey,
    settings,
    mode = { type: 'duration', durationMinutes: 60 },
    now,
  } = params;

  const basePrimaryHHMM = resolveRoutinePrimaryHHMM(routine, settings);
  const basePrimaryDate = buildDateFromKeyAndHHMM(dateKey, basePrimaryHHMM);
  let currentScheduledDate = resolveRoutinePrimaryDate(
    routine,
    dateKey,
    settings,
    existingRecord
  );

  let secondaryBaseDate: Date | null = null;
  if (routine.secondarySchedule) {
    secondaryBaseDate = buildDateFromKeyAndHHMM(
      dateKey,
      routine.secondarySchedule.timeHHMM
    );
    const effectiveAfternoonHHMM =
      existingRecord?.postponedAfternoonTimeHHMM ??
      routine.secondarySchedule.timeHHMM;
    let afternoonScheduledDate = buildDateFromKeyAndHHMM(
      dateKey,
      effectiveAfternoonHHMM
    );
    if (
      existingRecord?.postponedAfternoonTimeHHMM &&
      afternoonScheduledDate.getTime() < basePrimaryDate.getTime()
    ) {
      afternoonScheduledDate = buildDateFromKeyAndHHMM(
        addDaysToDateKey(dateKey, 1),
        effectiveAfternoonHHMM
      );
    }

    if (
      existingRecord?.postponedAfternoonTimeHHMM ||
      (now && now.getTime() >= secondaryBaseDate.getTime())
    ) {
      if (afternoonScheduledDate.getTime() > currentScheduledDate.getTime()) {
        currentScheduledDate = afternoonScheduledDate;
      }
    }
  }

  const sleepCapDate = resolveSleepCapDate(dateKey, settings, basePrimaryDate);
  const capMs = Math.max(basePrimaryDate.getTime(), sleepCapDate.getTime());

  let proposedMs: number;
  if (mode.type === 'duration' || mode.type === 'add_hours') {
    const durationMinutes =
      mode.type === 'add_hours' ? mode.hours * 60 : mode.durationMinutes;
    const deltaMs = durationMinutes * 60_000;
    let baseMs = currentScheduledDate.getTime();
    if (now && baseMs < now.getTime()) {
      const nowMinute = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours(),
        now.getMinutes(),
        0,
        0
      );
      baseMs = Math.max(baseMs, nowMinute.getTime());
    }
    proposedMs = baseMs + deltaMs;
  } else {
    let candidate = buildDateFromKeyAndHHMM(dateKey, mode.targetHHMM);
    if (candidate.getTime() < basePrimaryDate.getTime()) {
      candidate = buildDateFromKeyAndHHMM(
        addDaysToDateKey(dateKey, 1),
        mode.targetHHMM
      );
    }
    proposedMs = Math.max(currentScheduledDate.getTime(), candidate.getTime());
  }

  const clampedMs = Math.min(proposedMs, capMs);
  const reachedCap = proposedMs >= capMs;
  const nextDate = new Date(clampedMs);
  const nextTimeHHMM = formatHHMM(nextDate.getHours(), nextDate.getMinutes());
  const nextDateISO = nextDate.toISOString();

  const previousPostponeCount =
    existingRecord?.postponeCount ??
    existingRecord?.notAtHomePostponeCount ??
    0;

  const record: RoutineDayRecord = {
    ...(existingRecord ?? {
      routineId: routine.id,
      dateKey,
      status: 'pending',
    }),
    routineId: routine.id,
    routineName: routine.name,
    dateKey,
    status:
      existingRecord?.status === 'completed' ? 'completed' : 'pending',
    postponeCount: previousPostponeCount + 1,
    postponedPrimaryTimeHHMM: nextTimeHHMM,
    postponedPrimaryAtISO: nextDateISO,
  };

  if (
    secondaryBaseDate &&
    (nextDate.getTime() >= secondaryBaseDate.getTime() ||
      existingRecord?.postponedAfternoonTimeHHMM)
  ) {
    record.postponedAfternoonTimeHHMM = nextTimeHHMM;
  }

  delete record.blockReason;
  delete record.blockedByRoutineId;

  return {
    record,
    reachedCap,
    nextTimeHHMM,
    nextDateISO,
    sleepCapHHMM: settings.sleepTimeHHMM,
  };
}

/**
 * Restablece cualquier posposición activa de una tarea en `dateKey` para devolverla a su horario original.
 */
export function resetRoutinePostpone(
  recordOrRoutine: RoutineDayRecord | RoutineConfig | undefined,
  existingRecord?: RoutineDayRecord,
  dateKey?: string
): RoutineDayRecord | undefined {
  if (!recordOrRoutine) return undefined;
  if ('dateKey' in recordOrRoutine && 'status' in recordOrRoutine) {
    const clean: RoutineDayRecord = { ...recordOrRoutine };
    delete clean.postponeCount;
    delete clean.postponedPrimaryTimeHHMM;
    delete clean.postponedPrimaryAtISO;
    delete clean.notAtHomePostponeCount;
    delete clean.postponedAfternoonTimeHHMM;
    return clean;
  }
  const routine = recordOrRoutine;
  const clean: RoutineDayRecord = {
    ...(existingRecord ?? {
      routineId: routine.id,
      dateKey: dateKey ?? '',
      status: 'pending',
    }),
    routineId: routine.id,
    routineName: routine.name,
    dateKey: dateKey ?? existingRecord?.dateKey ?? '',
    status: existingRecord?.status === 'completed' ? 'completed' : 'pending',
  };
  delete clean.postponeCount;
  delete clean.postponedPrimaryTimeHHMM;
  delete clean.postponedPrimaryAtISO;
  delete clean.notAtHomePostponeCount;
  delete clean.postponedAfternoonTimeHHMM;
  return clean;
}

// @end: Scheduler-Checklist-And-Postpone

// @section: Scheduler-Blocking-And-Modes

/**
 * Evalúa si un instante `targetAlarmDate` de `targetRoutineId` cae dentro de las 24 horas exactas
 * posteriores al marcado real (`completedAtISO`) de una rutina bloqueante (ej. Dermastamp).
 * Regla: (sourceCompletedMs < targetAlarmMs) && (targetAlarmMs <= sourceCompletedMs + blockDurationHours * 3600_000)
 */
export function findActiveBlockForTimestamp(
  targetRoutineId: string,
  targetAlarmDate: Date,
  blockingRules: BlockingRule[],
  records: RoutineDayRecord[]
): {
  blocked: boolean;
  rule?: BlockingRule;
  sourceRecord?: RoutineDayRecord;
} {
  const applicableRules = blockingRules.filter(
    (r) => r.targetRoutineId === targetRoutineId
  );
  if (applicableRules.length === 0) return { blocked: false };

  const targetMs = targetAlarmDate.getTime();

  for (const rule of applicableRules) {
    const windowMs = rule.blockDurationHours * 3600_000;
    for (const rec of records) {
      if (
        rec.routineId === rule.sourceRoutineId &&
        rec.status === 'completed' &&
        rec.completedAtISO
      ) {
        const completedMs = new Date(rec.completedAtISO).getTime();
        if (targetMs > completedMs && targetMs <= completedMs + windowMs) {
          return { blocked: true, rule, sourceRecord: rec };
        }
      }
    }
  }

  return { blocked: false };
}

/**
 * Devuelve el modo de aviso efectivo en el instante `now`.
 * Si el modo discreto o la pausa ya han caducado (`now >= untilISO`), vuelve automáticamente a `{ type: 'alarm' }`.
 */
export function resolveEffectiveNoticeMode(
  mode: ActiveNoticeMode,
  now: Date
): ActiveNoticeMode {
  if (mode.type === 'alarm') return mode;
  const untilMs = new Date(mode.untilISO).getTime();
  if (now.getTime() >= untilMs) {
    return { type: 'alarm' };
  }
  return mode;
}

/**
 * Determina el canal de entrega ('alarmkit' vs 'local_notification') para un aviso concreto en `promptDate`.
 * - Si el modo discreto está activo en `promptDate` Y la rutina tiene `allowDiscreetMode === true`
 *   (o si el usuario activó el modo discreto global para sustituir las alarmas de ese periodo cuando la tarea lo permite),
 *   usa `local_notification`.
 * - NOTA del requerimiento:
 *   "Mientras está activo, las alarmas de ese periodo se sustituyen por notificaciones locales (sin AlarmKit)... Cada tarea tiene la opción 'permitir modo discreto' o 'siempre alarma' (por defecto, siempre alarma)."
 *   Por tanto:
 *   - Si la tarea tiene `allowDiscreetMode: true` y `promptDate` cae dentro de la ventana del modo discreto -> `local_notification`.
 *   - Si la tarea tiene `allowDiscreetMode: false` ("siempre alarma") -> `alarmkit` (salvo que en Ajustes/entorno no haya AlarmKit o el usuario fuerce modo discreto en esa tarea).
 */
export function resolvePromptChannel(
  routine: RoutineConfig,
  promptDate: Date,
  mode: ActiveNoticeMode
): PromptDeliveryChannel {
  if (mode.type === 'discreet') {
    const startMs = new Date(mode.startedAtISO).getTime();
    const untilMs = new Date(mode.untilISO).getTime();
    const t = promptDate.getTime();
    if (t >= startMs && t < untilMs && routine.allowDiscreetMode) {
      return 'local_notification';
    }
  }
  return 'alarmkit';
}

// @end: Scheduler-Blocking-And-Modes

// @section: Scheduler-Engine-7Days

export interface ComputeScheduleInput {
  now: Date;
  routines: RoutineConfig[];
  blockingRules: BlockingRule[];
  records: RoutineDayRecord[];
  settings: GlobalSettings;
  noticeMode: ActiveNoticeMode;
  horizonDays?: number; // Por defecto 7 días
}

const DEFAULT_TASK_ACTIONS: NotificationActionId[] = [
  'DONE',
  'POSTPONE_1H',
  'PAUSE_2H',
];

/**
 * Motor principal puro:
 * Calcula todas las alarmas e insistencias de los próximos 7 días,
 * cancela/omite automáticamente cualquier alarma de Minoxidil que caiga dentro de las 24h exactas
 * desde que se marcó el Dermastamp (si el Minoxidil no se había marcado ya antes),
 * gestiona la posposición por tarea (+1h, +2h, +4h o hasta una hora concreta con tope en la hora de dormir),
 * gestiona el doble aviso de la Pastilla (mañana 09:00 + tarde 15:30),
 * limita la ráfaga de insistencias al máximo configurable (por defecto 6),
 * y gestiona el Modo Discreto y la Pausa con un único aviso resumen de recuperación.
 */
export function computeSchedule(
  input: ComputeScheduleInput
): ScheduleComputationResult {
  const {
    now,
    routines,
    blockingRules,
    records,
    settings,
    noticeMode,
    horizonDays = 7,
  } = input;

  const effectiveMode = resolveEffectiveNoticeMode(noticeMode, now);
  const nowMs = now.getTime();
  const todayKey = formatDateKey(now);

  // Mapa rápido de registros existentes por routineId + dateKey
  const recordMap = new Map<string, RoutineDayRecord>();
  for (const r of records) {
    recordMap.set(`${r.routineId}__${r.dateKey}`, { ...r });
  }

  const upcomingSevenDaysOverview: ScheduledPrompt[] = [];
  const candidateActivePrompts: ScheduledPrompt[] = [];
  const autoOmittedRecords: RoutineDayRecord[] = [];

  // Si hay una pausa activa ("Pausar avisos hasta HH:MM"), guardamos las tareas que quedaron silenciadas durante la pausa
  const pauseUntilMs =
    effectiveMode.type === 'paused'
      ? new Date(effectiveMode.untilISO).getTime()
      : null;
  const pausedPendingRoutines = new Map<string, string>();

  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
    const dateKey = addDaysToDateKey(todayKey, dayOffset);

    for (const routine of routines) {
      if (!doesRoutineApplyOnDate(routine, dateKey)) continue;

      const mapKey = `${routine.id}__${dateKey}`;
      const existingRec = recordMap.get(mapKey);

      // Si la rutina YA fue completada en ese dateKey, se cancelan todas sus alarmas pendientes de ese día
      if (existingRec?.status === 'completed') {
        continue;
      }

      const primaryDate = resolveRoutinePrimaryDate(
        routine,
        dateKey,
        settings,
        existingRec
      );
      const blockCheck = findActiveBlockForTimestamp(
        routine.id,
        primaryDate,
        blockingRules,
        records
      );

      // Si la alarma cae dentro de las 24h exactas tras marcar el dermastamp (y no estaba ya completada antes)
      if (blockCheck.blocked && blockCheck.rule && blockCheck.sourceRecord) {
        const omittedRec: RoutineDayRecord = {
          routineId: routine.id,
          dateKey,
          status: 'omitted_by_block',
          blockReason: blockCheck.rule.statusLabel,
          blockedByRoutineId: blockCheck.rule.sourceRoutineId,
        };
        if (existingRec?.postponedPrimaryTimeHHMM) {
          omittedRec.postponedPrimaryTimeHHMM =
            existingRec.postponedPrimaryTimeHHMM;
          omittedRec.postponedPrimaryAtISO = existingRec.postponedPrimaryAtISO;
          omittedRec.postponeCount = existingRec.postponeCount;
        }
        autoOmittedRecords.push(omittedRec);
        recordMap.set(mapKey, omittedRec);

        const detId = buildDeterministicStringId(
          routine.id,
          dateKey,
          'primary',
          0
        );
        upcomingSevenDaysOverview.push({
          deterministicId: detId,
          notificationNumericId: toDeterministicNumericId(detId),
          alarmUuid: toDeterministicUuid(detId),
          routineId: routine.id,
          routineName: routine.name,
          dateKey,
          scheduledAtISO: primaryDate.toISOString(),
          kind: 'primary',
          channel: resolvePromptChannel(routine, primaryDate, effectiveMode),
          blocked: true,
          blockedReason: blockCheck.rule.statusLabel,
          blockedByCompletedAtISO: blockCheck.sourceRecord.completedAtISO,
          actions: DEFAULT_TASK_ACTIONS,
        });
        continue;
      }

      // Vista general de los próximos 7 días (alarma principal)
      const primaryDetId = buildDeterministicStringId(
        routine.id,
        dateKey,
        'primary',
        0
      );
      const primaryChannel = resolvePromptChannel(
        routine,
        primaryDate,
        effectiveMode
      );

      upcomingSevenDaysOverview.push({
        deterministicId: primaryDetId,
        notificationNumericId: toDeterministicNumericId(primaryDetId),
        alarmUuid: toDeterministicUuid(primaryDetId),
        routineId: routine.id,
        routineName: routine.name,
        dateKey,
        scheduledAtISO: primaryDate.toISOString(),
        kind: 'primary',
        channel: primaryChannel,
        blocked: false,
        actions: DEFAULT_TASK_ACTIONS,
      });

      const maxInsistenceCount =
        routine.maxInsistenceCount ??
        settings.maxInsistenceCount ??
        DEFAULT_MAX_INSISTENCE_COUNT;

      // Generar ventana de alarma principal + insistencias (limitada a maxInsistenceCount, por defecto 6)
      appendPromptSeries({
        routine,
        dateKey,
        baseDate: primaryDate,
        primaryKind: 'primary',
        insistenceKind: 'insistence',
        intervalMinutes: getEffectiveIntervalMinutes(
          routine,
          primaryDate,
          effectiveMode
        ),
        durationMinutes: routine.insistDurationMinutes,
        maxInsistenceCount,
        actions: DEFAULT_TASK_ACTIONS,
        nowMs,
        pauseUntilMs,
        todayKey,
        pausedPendingRoutines,
        effectiveMode,
        blockingRules,
        records,
        targetList: candidateActivePrompts,
      });

      // Si la rutina tiene segundo aviso (ej. Pastilla por la tarde a las 15:30 o posposición de tarde heredada)
      if (routine.secondarySchedule) {
        const sec = routine.secondarySchedule;
        const baseAfternoonDate = buildDateFromKeyAndHHMM(
          dateKey,
          sec.timeHHMM
        );
        const effectiveAfternoonHHMM =
          existingRec?.postponedAfternoonTimeHHMM ?? sec.timeHHMM;
        let secondaryDate = buildDateFromKeyAndHHMM(
          dateKey,
          effectiveAfternoonHHMM
        );
        if (
          existingRec?.postponedAfternoonTimeHHMM &&
          secondaryDate.getTime() < baseAfternoonDate.getTime()
        ) {
          secondaryDate = buildDateFromKeyAndHHMM(
            addDaysToDateKey(dateKey, 1),
            effectiveAfternoonHHMM
          );
        }

        // Si la tarea aún no se ha pospuesto a una hora igual o posterior al aviso de tarde,
        // programamos el segundo aviso de la tarde y sus insistencias.
        if (primaryDate.getTime() < secondaryDate.getTime()) {
          const secDetId = buildDeterministicStringId(
            routine.id,
            dateKey,
            'secondary_primary',
            0
          );
          upcomingSevenDaysOverview.push({
            deterministicId: secDetId,
            notificationNumericId: toDeterministicNumericId(secDetId),
            alarmUuid: toDeterministicUuid(secDetId),
            routineId: routine.id,
            routineName: `${routine.name} (Tarde)`,
            dateKey,
            scheduledAtISO: secondaryDate.toISOString(),
            kind: 'secondary_primary',
            channel: resolvePromptChannel(routine, secondaryDate, effectiveMode),
            blocked: false,
            actions: DEFAULT_TASK_ACTIONS,
          });

          appendPromptSeries({
            routine,
            dateKey,
            baseDate: secondaryDate,
            primaryKind: 'secondary_primary',
            insistenceKind: 'secondary_insistence',
            intervalMinutes: getEffectiveIntervalMinutes(
              routine,
              secondaryDate,
              effectiveMode,
              sec.insistIntervalMinutes
            ),
            durationMinutes: sec.insistDurationMinutes,
            maxInsistenceCount,
            actions: DEFAULT_TASK_ACTIONS,
            nowMs,
            pauseUntilMs,
            todayKey,
            pausedPendingRoutines,
            effectiveMode,
            blockingRules,
            records,
            targetList: candidateActivePrompts,
          });
        }
      }
    }
  }

  // Si hay una pausa activa y existen tareas pendientes cuya hora ya pasó o caía dentro de la pausa,
  // al terminar la pausa salta UN ÚNICO aviso resumen de recuperación (no todas a la vez).
  if (
    effectiveMode.type === 'paused' &&
    pauseUntilMs !== null &&
    pauseUntilMs > nowMs &&
    pausedPendingRoutines.size > 0
  ) {
    const recoveryDate = new Date(pauseUntilMs);
    const recoveryDetId = buildDeterministicStringId(
      'recovery',
      todayKey,
      'pause_recovery',
      0
    );
    const pendingIds = Array.from(pausedPendingRoutines.keys());
    const pendingNames = Array.from(pausedPendingRoutines.values());
    const count = pendingIds.length;

    candidateActivePrompts.push({
      deterministicId: recoveryDetId,
      notificationNumericId: toDeterministicNumericId(recoveryDetId),
      alarmUuid: toDeterministicUuid(recoveryDetId),
      routineId: pendingIds.join(','),
      routineName:
        count === 1
          ? `Recuperación: ${pendingNames[0]}`
          : `Recuperación (${count} pendientes: ${pendingNames.join(', ')})`,
      dateKey: todayKey,
      scheduledAtISO: recoveryDate.toISOString(),
      kind: 'pause_recovery',
      channel: 'alarmkit',
      blocked: false,
      actions: DEFAULT_TASK_ACTIONS,
    });
  }

  // Ordenar cronológicamente y priorizar para no superar nunca el límite de 60 avisos del sistema en iOS:
  // Prioridad 1: Avisos de las próximas 24h (incluyendo toda su ráfaga de insistencia) + todos los avisos principales de los 7 días.
  // Prioridad 2: Insistencias de días futuros hasta completar el cupo de IOS_MAX_PENDING_NOTIFICATIONS.
  candidateActivePrompts.sort(
    (a, b) =>
      new Date(a.scheduledAtISO).getTime() -
      new Date(b.scheduledAtISO).getTime()
  );

  const highPriority: ScheduledPrompt[] = [];
  const lowPriority: ScheduledPrompt[] = [];
  const next24hMs = nowMs + 24 * 3600_000;

  for (const p of candidateActivePrompts) {
    const pMs = new Date(p.scheduledAtISO).getTime();
    const isPrimary =
      p.kind === 'primary' ||
      p.kind === 'secondary_primary' ||
      p.kind === 'pause_recovery';
    if (isPrimary || pMs <= next24hMs) {
      highPriority.push(p);
    } else {
      lowPriority.push(p);
    }
  }

  const activePromptsToSchedule = [
    ...highPriority,
    ...lowPriority.slice(
      0,
      Math.max(0, IOS_MAX_PENDING_NOTIFICATIONS - highPriority.length)
    ),
  ]
    .slice(0, IOS_MAX_PENDING_NOTIFICATIONS)
    .sort(
      (a, b) =>
        new Date(a.scheduledAtISO).getTime() -
        new Date(b.scheduledAtISO).getTime()
    );

  upcomingSevenDaysOverview.sort(
    (a, b) =>
      new Date(a.scheduledAtISO).getTime() -
      new Date(b.scheduledAtISO).getTime()
  );

  return {
    upcomingSevenDaysOverview,
    activePromptsToSchedule,
    autoOmittedRecords,
    effectiveMode,
  };
}

function getEffectiveIntervalMinutes(
  routine: RoutineConfig,
  promptDate: Date,
  mode: ActiveNoticeMode,
  overrideInterval?: number
): number {
  if (mode.type === 'discreet' && routine.allowDiscreetMode) {
    const startMs = new Date(mode.startedAtISO).getTime();
    const untilMs = new Date(mode.untilISO).getTime();
    const t = promptDate.getTime();
    if (t >= startMs && t < untilMs) {
      return mode.discreetIntervalMinutes;
    }
  }
  return overrideInterval ?? routine.insistIntervalMinutes;
}

interface AppendSeriesParams {
  routine: RoutineConfig;
  dateKey: string;
  baseDate: Date;
  primaryKind: PromptKind;
  insistenceKind: PromptKind;
  intervalMinutes: number;
  durationMinutes: number;
  maxInsistenceCount: number;
  actions: NotificationActionId[];
  nowMs: number;
  pauseUntilMs: number | null;
  todayKey: string;
  pausedPendingRoutines: Map<string, string>;
  effectiveMode: ActiveNoticeMode;
  blockingRules: BlockingRule[];
  records: RoutineDayRecord[];
  targetList: ScheduledPrompt[];
}

function appendPromptSeries(params: AppendSeriesParams): void {
  const {
    routine,
    dateKey,
    baseDate,
    primaryKind,
    insistenceKind,
    intervalMinutes,
    durationMinutes,
    maxInsistenceCount,
    actions,
    nowMs,
    pauseUntilMs,
    todayKey,
    pausedPendingRoutines,
    effectiveMode,
    blockingRules,
    records,
    targetList,
  } = params;

  const safeInterval = Math.max(1, intervalMinutes);
  const rawSteps = Math.floor(durationMinutes / safeInterval);
  const maxAllowedInsistences = Math.max(0, Math.floor(maxInsistenceCount));
  const totalSteps = Math.min(rawSteps, maxAllowedInsistences);

  for (let step = 0; step <= totalSteps; step++) {
    const promptTimeMs = baseDate.getTime() + step * safeInterval * 60_000;
    const promptDate = new Date(promptTimeMs);

    // Si algún aviso de insistencia entra dentro de una ventana de bloqueo de 24h, tampoco se agenda
    const blockCheck = findActiveBlockForTimestamp(
      routine.id,
      promptDate,
      blockingRules,
      records
    );
    if (blockCheck.blocked) {
      continue;
    }

    // Si hay una pausa activa hasta HH:MM y el aviso cae antes o en el límite de la pausa:
    // Se silencia por completo y se registra la tarea para el aviso único resumen al terminar la pausa.
    if (pauseUntilMs !== null && promptTimeMs <= pauseUntilMs) {
      if (dateKey === todayKey || promptTimeMs >= nowMs) {
        pausedPendingRoutines.set(routine.id, routine.name);
      }
      continue;
    }

    // Solo enviamos al sistema operativo avisos futuros (o del minuto actual)
    if (promptTimeMs < nowMs) {
      continue;
    }

    const kind: PromptKind = step === 0 ? primaryKind : insistenceKind;
    const detId = buildDeterministicStringId(routine.id, dateKey, kind, step);
    const channel = resolvePromptChannel(routine, promptDate, effectiveMode);

    targetList.push({
      deterministicId: detId,
      notificationNumericId: toDeterministicNumericId(detId),
      alarmUuid: toDeterministicUuid(detId),
      routineId: routine.id,
      routineName: routine.name,
      dateKey,
      scheduledAtISO: promptDate.toISOString(),
      kind,
      channel,
      blocked: false,
      actions,
    });
  }
}

// @end: Scheduler-Engine-7Days

// @section: Scheduler-History-And-Streaks

export interface DaySummary {
  dateKey: string;
  /** Estado global del día:
   * - 'completed': todas las tareas aplicables del día están hechas (o hechas + omitidas por dermastamp)
   * - 'omitted_by_block': todas las tareas aplicables del día fueron omitidas por regla de bloqueo
   * - 'skipped': día pasado con al menos una tarea aplicable no completada ni omitida
   * - 'pending': día actual o futuro aún en curso
   */
  overallStatus: 'completed' | 'omitted_by_block' | 'skipped' | 'pending';
  routineStatuses: {
    routineId: string;
    routineName: string;
    status: 'completed' | 'omitted_by_block' | 'skipped' | 'pending';
    reason?: string;
  }[];
}

/**
 * Evalúa el resumen de un día `dateKey` combinando las rutinas aplicables,
 * los registros guardados y la regla de bloqueo de 24h exactas del dermastamp.
 */
export function evaluateDaySummary(
  dateKey: string,
  todayKey: string,
  routines: RoutineConfig[],
  records: RoutineDayRecord[],
  blockingRules: BlockingRule[],
  settings: GlobalSettings
): DaySummary {
  const applicable = routines.filter((r) => doesRoutineApplyOnDate(r, dateKey));
  const routineStatuses: DaySummary['routineStatuses'] = [];
  const activeRoutineIds = new Set(routines.map((r) => r.id));

  for (const routine of applicable) {
    const existing = records.find(
      (r) => r.routineId === routine.id && r.dateKey === dateKey
    );

    if (existing?.status === 'completed') {
      routineStatuses.push({
        routineId: routine.id,
        routineName: routine.name,
        status: 'completed',
      });
      continue;
    }

    // Comprobar dinámicamente si la hora de la alarma de ese día caía en las 24h exactas de un dermastamp completado
    const primaryDate = resolveRoutinePrimaryDate(
      routine,
      dateKey,
      settings,
      existing
    );
    const blockCheck = findActiveBlockForTimestamp(
      routine.id,
      primaryDate,
      blockingRules,
      records
    );
    if (blockCheck.blocked && blockCheck.rule) {
      routineStatuses.push({
        routineId: routine.id,
        routineName: routine.name,
        status: 'omitted_by_block',
        reason: blockCheck.rule.statusLabel,
      });
      continue;
    }

    if (
      existing?.status === 'omitted_by_block' &&
      (!existing.blockedByRoutineId ||
        !activeRoutineIds.has(existing.blockedByRoutineId))
    ) {
      routineStatuses.push({
        routineId: routine.id,
        routineName: routine.name,
        status: 'omitted_by_block',
        reason: existing.blockReason,
      });
      continue;
    }

    if (existing?.status === 'skipped' || dateKey < todayKey) {
      routineStatuses.push({
        routineId: routine.id,
        routineName: routine.name,
        status: 'skipped',
      });
    } else {
      routineStatuses.push({
        routineId: routine.id,
        routineName: routine.name,
        status: 'pending',
      });
    }
  }

  // Conservar el historial pasado de rutinas eliminadas mostrando su nombre guardado
  for (const rec of records) {
    if (rec.dateKey !== dateKey) continue;
    if (activeRoutineIds.has(rec.routineId)) continue;
    if (
      rec.status === 'completed' ||
      rec.status === 'omitted_by_block' ||
      rec.status === 'skipped'
    ) {
      routineStatuses.push({
        routineId: rec.routineId,
        routineName: rec.routineName ?? rec.routineId,
        status: rec.status,
        reason: rec.blockReason,
      });
    }
  }

  let overallStatus: DaySummary['overallStatus'] = 'pending';
  if (routineStatuses.length > 0) {
    const hasSkipped = routineStatuses.some((s) => s.status === 'skipped');
    const hasPending = routineStatuses.some((s) => s.status === 'pending');
    const allOmitted = routineStatuses.every(
      (s) => s.status === 'omitted_by_block'
    );

    if (hasSkipped) {
      overallStatus = 'skipped';
    } else if (hasPending) {
      overallStatus = 'pending';
    } else if (allOmitted) {
      overallStatus = 'omitted_by_block';
    } else {
      overallStatus = 'completed';
    }
  }

  return {
    dateKey,
    overallStatus,
    routineStatuses,
  };
}

/**
 * Calcula la racha actual de días cumplidos consecutivos hacia atrás desde `todayKey`.
 * IMPORTANTE: El estado `'omitted_by_block'` ("omitido por dermastamp") NO rompe la racha.
 */
export function computeCurrentStreakDays(
  todayKey: string,
  routines: RoutineConfig[],
  records: RoutineDayRecord[],
  blockingRules: BlockingRule[],
  settings: GlobalSettings
): number {
  let streak = 0;

  // Si hoy ya tiene todas sus tareas completadas (u omitidas por bloqueo), suma hoy;
  // si hoy aún está 'pending', empezamos a contar desde ayer sin romper la racha.
  const todaySummary = evaluateDaySummary(
    todayKey,
    todayKey,
    routines,
    records,
    blockingRules,
    settings
  );

  if (
    todaySummary.overallStatus === 'completed' ||
    todaySummary.overallStatus === 'omitted_by_block'
  ) {
    streak++;
  } else if (todaySummary.overallStatus === 'skipped') {
    return 0;
  }

  // Recorrer días anteriores hacia atrás (hasta 365 días)
  for (let i = 1; i <= 365; i++) {
    const pastKey = addDaysToDateKey(todayKey, -i);
    // Comprobar si hay algún registro en o antes de esa fecha para no contar días previos al uso de la app
    const hasAnyRecordOnOrBefore = records.some(
      (r) => r.dateKey <= pastKey && r.status !== 'pending'
    );
    if (!hasAnyRecordOnOrBefore) {
      break;
    }

    const summary = evaluateDaySummary(
      pastKey,
      todayKey,
      routines,
      records,
      blockingRules,
      settings
    );

    if (summary.overallStatus === 'completed') {
      streak++;
    } else if (summary.overallStatus === 'omitted_by_block') {
      // No rompe la racha y mantiene la continuidad
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export interface DueProgressSummary {
  /** Porcentaje de cumplimiento sobre alarmas ya vencidas (0..100) */
  percentage: number;
  /** Tareas ya vencidas que están completadas (o adelantadas completadas) */
  completedDueCount: number;
  /** Total de tareas del día cuya hora de alarma ya ha vencido (o ya se completaron) */
  totalDueCount: number;
  /** Total de tareas del día aún futuras y pendientes */
  upcomingFutureCount: number;
  /** Tareas omitidas por bloqueo (no cuentan como fallo) */
  omittedCount: number;
}

/**
 * Calcula el recuento "Hechas X/Y" y el porcentaje de cumplimiento del día en curso `now`.
 * Regla crítica:
 * - Solo cuenta en el denominador (`totalDueCount`) las alarmas cuya hora YA ha vencido (`primaryDate <= now`)
 *   o aquellas que el usuario ya haya completado por adelantado.
 * - Las alarmas futuras (hora aún no llegada y pendientes) NUNCA cuentan como pendiente vencida ni restan porcentaje.
 * - Con 2 hechas de 2 vencidas hoy (aunque quede 1 futura a las 22:00), devuelve `completedDueCount = 2`, `totalDueCount = 2`, `percentage = 100`.
 */
export function computeDueProgressForDay(
  now: Date,
  routines: RoutineConfig[],
  records: RoutineDayRecord[],
  blockingRules: BlockingRule[],
  settings: GlobalSettings
): DueProgressSummary {
  const todayKey = formatDateKey(now);
  const nowMs = now.getTime();
  const applicable = routines.filter((r) =>
    doesRoutineApplyOnDate(r, todayKey)
  );
  const activeRoutineIds = new Set(routines.map((r) => r.id));

  let completedDueCount = 0;
  let totalDueCount = 0;
  let upcomingFutureCount = 0;
  let omittedCount = 0;

  for (const routine of applicable) {
    const existing = records.find(
      (r) => r.routineId === routine.id && r.dateKey === todayKey
    );
    const primaryDate = resolveRoutinePrimaryDate(
      routine,
      todayKey,
      settings,
      existing
    );
    const isDue = primaryDate.getTime() <= nowMs;

    if (existing?.status === 'completed') {
      completedDueCount++;
      totalDueCount++;
      continue;
    }

    const blockCheck = findActiveBlockForTimestamp(
      routine.id,
      primaryDate,
      blockingRules,
      records
    );
    const isStaleBlockFromActiveRoutine =
      existing?.status === 'omitted_by_block' &&
      existing.blockedByRoutineId &&
      activeRoutineIds.has(existing.blockedByRoutineId) &&
      !blockCheck.blocked;

    if (
      (existing?.status === 'omitted_by_block' &&
        !isStaleBlockFromActiveRoutine) ||
      (blockCheck.blocked && blockCheck.rule)
    ) {
      omittedCount++;
      continue;
    }

    if (isDue) {
      // Ya venció la hora de su alarma y aún no está completada
      totalDueCount++;
    } else {
      // Aún es futura: no penaliza ni entra en el denominador de vencidas
      upcomingFutureCount++;
    }
  }

  const percentage =
    totalDueCount === 0
      ? 100
      : Math.round((completedDueCount / totalDueCount) * 100);

  return {
    percentage,
    completedDueCount,
    totalDueCount,
    upcomingFutureCount,
    omittedCount,
  };
}

/**
 * Calcula el porcentaje de cumplimiento de los últimos 7 días contando SOLO alarmas ya vencidas (hora pasada),
 * nunca las futuras.
 * IMPORTANTE: Las tareas "omitidas por dermastamp" (`omitted_by_block`) NO cuentan como fallo
 * en el porcentaje de cumplimiento (se excluyen del denominador de fallos).
 */
export function computeWeeklyCompliancePercentage(
  todayKeyOrNow: string | Date,
  routines: RoutineConfig[],
  records: RoutineDayRecord[],
  blockingRules: BlockingRule[],
  settings: GlobalSettings
): {
  percentage: number;
  completedCount: number;
  evaluableCount: number;
  omittedCount: number;
} {
  const nowDate =
    typeof todayKeyOrNow === 'string'
      ? buildDateFromKeyAndHHMM(todayKeyOrNow, '23:59')
      : todayKeyOrNow;
  const todayKey = formatDateKey(nowDate);
  const nowMs = nowDate.getTime();
  const activeRoutineIds = new Set(routines.map((r) => r.id));

  let completedCount = 0;
  let evaluableCount = 0;
  let omittedCount = 0;

  for (let i = 0; i < 7; i++) {
    const key = addDaysToDateKey(todayKey, -i);

    // Para días anteriores a hoy (i > 0), solo evaluar si ya existía actividad en o antes de esa fecha
    // (evita contar como fallos los días previos a que el usuario empezara a usar la app).
    if (i > 0) {
      const hasHistoryOnOrBefore = records.some(
        (r) => r.dateKey <= key && r.status !== 'pending'
      );
      if (!hasHistoryOnOrBefore) {
        continue;
      }
    }

    const applicable = routines.filter((r) => doesRoutineApplyOnDate(r, key));

    for (const routine of applicable) {
      const existing = records.find(
        (r) => r.routineId === routine.id && r.dateKey === key
      );
      const primaryDate = resolveRoutinePrimaryDate(
        routine,
        key,
        settings,
        existing
      );

      if (existing?.status === 'completed') {
        evaluableCount++;
        completedCount++;
        continue;
      }

      const blockCheck = findActiveBlockForTimestamp(
        routine.id,
        primaryDate,
        blockingRules,
        records
      );
      const isStaleBlockFromActiveRoutine =
        existing?.status === 'omitted_by_block' &&
        existing.blockedByRoutineId &&
        activeRoutineIds.has(existing.blockedByRoutineId) &&
        !blockCheck.blocked;

      if (
        (existing?.status === 'omitted_by_block' &&
          !isStaleBlockFromActiveRoutine) ||
        (blockCheck.blocked && blockCheck.rule)
      ) {
        omittedCount++;
        continue;
      }

      // Solo cuenta como alarma evaluable vencida si su hora ya ha pasado respecto a `nowDate`
      if (primaryDate.getTime() <= nowMs) {
        evaluableCount++;
      }
    }
  }

  const percentage =
    evaluableCount === 0
      ? 100
      : Math.round((completedCount / evaluableCount) * 100);

  return {
    percentage,
    completedCount,
    evaluableCount,
    omittedCount,
  };
}

const SHORT_WEEKDAYS_LOWER = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const SHORT_MONTHS_LOWER = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];
const FULL_MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/**
 * Formatea una fecha `YYYY-MM-DD` de forma relativa a `todayKey`:
 * - `"Hoy"`
 * - `"Mañana"`
 * - `"Ayer"`
 * - `"mié 14 oct"`
 */
export function formatRelativeDateLabel(
  dateKey: string,
  todayKey: string
): string {
  if (dateKey === todayKey) return 'Hoy';
  if (dateKey === addDaysToDateKey(todayKey, 1)) return 'Mañana';
  if (dateKey === addDaysToDateKey(todayKey, -1)) return 'Ayer';

  const dt = buildDateFromKeyAndHHMM(dateKey, '12:00');
  const w = SHORT_WEEKDAYS_LOWER[dt.getDay()];
  const d = dt.getDate();
  const m = SHORT_MONTHS_LOWER[dt.getMonth()];
  return `${w} ${d} ${m}`;
}

/**
 * Formatea mes y año como `"Octubre de 2026"` (preposición `"de"` siempre en minúscula).
 */
export function formatMonthYearEs(year: number, monthZeroIndexed: number): string {
  const monthName = FULL_MONTHS_ES[monthZeroIndexed] ?? 'Octubre';
  return `${monthName} de ${year}`;
}

export interface SideloadSignatureStatus {
  hasRecord: boolean;
  configured: boolean;
  installedAtISO?: string;
  day6WarningAtISO?: string;
  warningAtISO?: string;
  expiresAtISO?: string;
  daysRemaining: number | null;
  remainingDays: number | null;
  expired: boolean;
}

/**
 * Calcula los días restantes de la firma gratuita de 7 días (Sideloadly)
 * y el instante del aviso preventivo en el día 6 ("La app caduca mañana: reinstálala con Sideloadly").
 */
export function computeSideloadSignatureStatus(
  arg1: string | Date | undefined,
  arg2?: string | Date
): SideloadSignatureStatus {
  const now = arg1 instanceof Date ? arg1 : arg2 instanceof Date ? arg2 : new Date();
  const lastReinstallISO =
    typeof arg1 === 'string'
      ? arg1
      : typeof arg2 === 'string'
      ? arg2
      : undefined;

  if (!lastReinstallISO) {
    return {
      hasRecord: false,
      configured: false,
      daysRemaining: null,
      remainingDays: null,
      expired: false,
    };
  }
  const installedMs = new Date(lastReinstallISO).getTime();
  if (Number.isNaN(installedMs)) {
    return {
      hasRecord: false,
      configured: false,
      daysRemaining: null,
      remainingDays: null,
      expired: false,
    };
  }
  const day6WarningMs = installedMs + 6 * 24 * 3600_000;
  const expiresMs = installedMs + 7 * 24 * 3600_000;
  const diffMs = expiresMs - now.getTime();
  const expired = diffMs <= 0;
  const daysRemaining = expired
    ? 0
    : Math.min(7, Math.max(0, Math.ceil(diffMs / (24 * 3600_000))));
  const warningISO = new Date(day6WarningMs).toISOString();

  return {
    hasRecord: true,
    configured: true,
    installedAtISO: new Date(installedMs).toISOString(),
    day6WarningAtISO: warningISO,
    warningAtISO: warningISO,
    expiresAtISO: new Date(expiresMs).toISOString(),
    daysRemaining,
    remainingDays: daysRemaining,
    expired,
  };
}

// @end: Scheduler-History-And-Streaks
