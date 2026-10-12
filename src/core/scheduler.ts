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
  PromptDeliveryChannel,
  PromptKind,
  RoutineConfig,
  RoutineDayRecord,
  ScheduleComputationResult,
  ScheduledPrompt,
} from './types';

/** Límite máximo de notificaciones locales que permite iOS (64). Usamos 60 por margen de seguridad. */
export const IOS_MAX_PENDING_NOTIFICATIONS = 60;

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
 * Construye el Date exacto de la alarma principal de una rutina para su `dateKey`.
 * Si la rutina depende de `relative_to_sleep` y la hora de dormir es de madrugada (01:00..05:59)
 * haciendo que la alarma caiga a partir de las 00:00 (ej. dormir 02:00 -> alarma 00:00),
 * pertenece a la noche de ese ciclo pero ocurre al inicio del día siguiente en el reloj civil
 * SOLO si el usuario la concibe como cierre del día; sin embargo, para que a las 22:00 o 00:00
 * sea predecible e inequívoco en cada fecha `dateKey` del calendario, anclamos `HH:MM` directamente
 * en el `dateKey` correspondiente, de modo que cada día natural tiene su toma a la hora calculada (`00:00`, `21:00`, `22:00`, etc.).
 */
export function resolveRoutinePrimaryDate(
  routine: RoutineConfig,
  dateKey: string,
  settings: GlobalSettings
): Date {
  const hhmm = resolveRoutinePrimaryHHMM(routine, settings);
  return buildDateFromKeyAndHHMM(dateKey, hhmm);
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
        completedChecklistSteps: [...(existingRecord.completedChecklistSteps ?? [])],
      }
    : {
        routineId: routine.id,
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
 * Lógica del botón "No estoy en casa" en el aviso de tarde de la pastilla:
 * Pospone 1 hora (repetible) desde la hora actual del aviso de tarde o desde `now` (si se pulsa más tarde),
 * nunca superando el límite de las 22:00 (`maxPostponeTimeHHMM`).
 */
export function postponeRoutineNotAtHome(
  routine: RoutineConfig,
  existingRecord: RoutineDayRecord | undefined,
  dateKey: string,
  _now?: Date
): { record: RoutineDayRecord; reachedCap: boolean; nextTimeHHMM: string } {
  const sec = routine.secondarySchedule;
  if (!sec || !sec.allowNotAtHomePostpone) {
    throw new Error(`La rutina ${routine.id} no admite posposición "No estoy en casa"`);
  }

  const maxDate = buildDateFromKeyAndHHMM(dateKey, sec.maxPostponeTimeHHMM);
  const currentAfternoonHHMM =
    existingRecord?.postponedAfternoonTimeHHMM ?? sec.timeHHMM;
  const currentScheduledDate = buildDateFromKeyAndHHMM(
    dateKey,
    currentAfternoonHHMM
  );

  // Pospone 1 hora (60 min) sobre la hora del aviso de tarde actual, con tope máximo en las 22:00
  const proposedMs =
    currentScheduledDate.getTime() + sec.postponeDurationMinutes * 60_000;
  const clampedMs = Math.min(proposedMs, maxDate.getTime());
  const reachedCap = proposedMs >= maxDate.getTime();

  const nextDate = new Date(clampedMs);
  const nextTimeHHMM = formatHHMM(nextDate.getHours(), nextDate.getMinutes());

  const record: RoutineDayRecord = {
    ...(existingRecord ?? {
      routineId: routine.id,
      dateKey,
      status: 'pending',
    }),
    notAtHomePostponeCount: (existingRecord?.notAtHomePostponeCount ?? 0) + 1,
    postponedAfternoonTimeHHMM: nextTimeHHMM,
  };

  return { record, reachedCap, nextTimeHHMM };
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

/**
 * Motor principal puro:
 * Calcula todas las alarmas e insistencias de los próximos 7 días,
 * cancela/omite automáticamente cualquier alarma de Minoxidil que caiga dentro de las 24h exactas
 * desde que se marcó el Dermastamp (si el Minoxidil no se había marcado ya antes),
 * gestiona el doble aviso de la Pastilla (mañana 09:00 + tarde 15:30 + posposición "No estoy en casa" hasta 22:00),
 * gestiona el Modo Discreto y la Pausa con alarma única de recuperación.
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

  // Si hay una pausa activa ("Pausar avisos hasta HH:MM"), guardamos si alguna tarea de hoy quedó silenciada durante la pausa
  const pauseUntilMs =
    effectiveMode.type === 'paused'
      ? new Date(effectiveMode.untilISO).getTime()
      : null;
  const pausedPendingRoutinesToday = new Set<string>();

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

      const primaryDate = resolveRoutinePrimaryDate(routine, dateKey, settings);
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
          actions: ['DONE'],
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
        actions: ['DONE'],
      });

      // Generar ventana de alarma principal + insistencias
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
        actions: ['DONE'],
        nowMs,
        pauseUntilMs,
        todayKey,
        pausedPendingRoutinesToday,
        effectiveMode,
        blockingRules,
        records,
        targetList: candidateActivePrompts,
      });

      // Si la rutina tiene segundo aviso (ej. Pastilla por la tarde a las 15:30 o pospuesta con "No estoy en casa")
      if (routine.secondarySchedule) {
        const sec = routine.secondarySchedule;
        const effectiveAfternoonHHMM =
          existingRec?.postponedAfternoonTimeHHMM ?? sec.timeHHMM;
        const secondaryDate = buildDateFromKeyAndHHMM(
          dateKey,
          effectiveAfternoonHHMM
        );

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
          actions: sec.allowNotAtHomePostpone
            ? ['DONE', 'NOT_AT_HOME']
            : ['DONE'],
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
          actions: sec.allowNotAtHomePostpone
            ? ['DONE', 'NOT_AT_HOME']
            : ['DONE'],
          nowMs,
          pauseUntilMs,
          todayKey,
          pausedPendingRoutinesToday,
          effectiveMode,
          blockingRules,
          records,
          targetList: candidateActivePrompts,
        });
      }
    }
  }

  // Si hay una pausa activa y existen tareas del día pendientes cuya hora ya pasó o caía dentro de la pausa,
  // al terminar la pausa salta UNA ÚNICA alarma de recuperación (no todas a la vez).
  if (
    effectiveMode.type === 'paused' &&
    pauseUntilMs !== null &&
    pauseUntilMs > nowMs &&
    pausedPendingRoutinesToday.size > 0
  ) {
    const recoveryDate = new Date(pauseUntilMs);
    const recoveryDetId = buildDeterministicStringId(
      'recovery',
      todayKey,
      'pause_recovery',
      0
    );
    candidateActivePrompts.push({
      deterministicId: recoveryDetId,
      notificationNumericId: toDeterministicNumericId(recoveryDetId),
      alarmUuid: toDeterministicUuid(recoveryDetId),
      routineId: Array.from(pausedPendingRoutinesToday).join(','),
      routineName: `Recuperación (${pausedPendingRoutinesToday.size} pendiente${pausedPendingRoutinesToday.size > 1 ? 's' : ''})`,
      dateKey: todayKey,
      scheduledAtISO: recoveryDate.toISOString(),
      kind: 'pause_recovery',
      channel: 'alarmkit',
      blocked: false,
      actions: ['DONE'],
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
  actions: ('DONE' | 'NOT_AT_HOME')[];
  nowMs: number;
  pauseUntilMs: number | null;
  todayKey: string;
  pausedPendingRoutinesToday: Set<string>;
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
    actions,
    nowMs,
    pauseUntilMs,
    todayKey,
    pausedPendingRoutinesToday,
    effectiveMode,
    blockingRules,
    records,
    targetList,
  } = params;

  const safeInterval = Math.max(1, intervalMinutes);
  const totalSteps = Math.floor(durationMinutes / safeInterval);

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

    // Si hay una pausa activa hasta HH:MM y el aviso cae antes de que termine la pausa:
    // Se silencia por completo y se registra la tarea para la alarma única de recuperación al terminar la pausa.
    if (pauseUntilMs !== null && promptTimeMs <= pauseUntilMs) {
      if (dateKey === todayKey) {
        pausedPendingRoutinesToday.add(routine.id);
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

    if (existing?.status === 'omitted_by_block') {
      routineStatuses.push({
        routineId: routine.id,
        routineName: routine.name,
        status: 'omitted_by_block',
        reason: existing.blockReason,
      });
      continue;
    }

    // Comprobar dinámicamente si la hora de la alarma de ese día caía en las 24h exactas de un dermastamp completado
    const primaryDate = resolveRoutinePrimaryDate(routine, dateKey, settings);
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
    const hasAnyRecordOnOrBefore = records.some((r) => r.dateKey <= pastKey);
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

/**
 * Calcula el porcentaje de cumplimiento de los últimos 7 días (excluyendo tareas pendientes de hoy).
 * IMPORTANTE: Las tareas "omitidas por dermastamp" (`omitted_by_block`) NO cuentan como fallo
 * en el porcentaje de cumplimiento (se excluyen del denominador de fallos).
 */
export function computeWeeklyCompliancePercentage(
  todayKey: string,
  routines: RoutineConfig[],
  records: RoutineDayRecord[],
  blockingRules: BlockingRule[],
  settings: GlobalSettings
): { percentage: number; completedCount: number; evaluableCount: number; omittedCount: number } {
  let completedCount = 0;
  let evaluableCount = 0;
  let omittedCount = 0;

  for (let i = 0; i < 7; i++) {
    const key = addDaysToDateKey(todayKey, -i);
    const summary = evaluateDaySummary(
      key,
      todayKey,
      routines,
      records,
      blockingRules,
      settings
    );

    for (const item of summary.routineStatuses) {
      if (item.status === 'omitted_by_block') {
        omittedCount++;
        // No cuenta como fallo en el porcentaje de cumplimiento
        continue;
      }
      if (item.status === 'pending') {
        continue;
      }
      evaluableCount++;
      if (item.status === 'completed') {
        completedCount++;
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

// @end: Scheduler-History-And-Streaks
