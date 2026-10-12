// @section: Preferences-Storage-Service

import { Preferences } from '@capacitor/preferences';
import {
  DEFAULT_BLOCKING_RULES,
  DEFAULT_GLOBAL_SETTINGS,
  createInitialRoutines,
} from '../core/defaults';
import { formatHHMM } from '../core/scheduler';
import type {
  ActiveNoticeMode,
  BlockingRule,
  DayRoutineStatus,
  GlobalSettings,
  RoutineConfig,
  RoutineDayRecord,
  ScheduleType,
} from '../core/types';

export const CURRENT_SCHEMA_VERSION = 3;

const KEYS = {
  SCHEMA_VERSION: 'rutinas_schema_version',
  SETTINGS: 'rutinas_settings_v1',
  ROUTINES: 'rutinas_configs_v1',
  BLOCKING_RULES: 'rutinas_blocking_rules_v1',
  RECORDS: 'rutinas_records_v1',
  NOTICE_MODE: 'rutinas_notice_mode_v1',
  SCHEDULED_IDS: 'rutinas_scheduled_ids_v1',
};

export interface PersistedAppState {
  schemaVersion?: number;
  settings: GlobalSettings;
  routines: RoutineConfig[];
  blockingRules: BlockingRule[];
  records: RoutineDayRecord[];
  noticeMode: ActiveNoticeMode;
}

const VALID_HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const VALID_DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SCHEDULE_TYPES: ScheduleType[] = [
  'relative_to_sleep',
  'fixed_daily',
  'weekly',
];
const VALID_RECORD_STATUSES: DayRoutineStatus[] = [
  'pending',
  'completed',
  'skipped',
  'omitted_by_block',
];

function isValidHHMM(val: unknown): val is string {
  return typeof val === 'string' && VALID_HHMM_REGEX.test(val);
}

function isValidISO(val: unknown): val is string {
  if (typeof val !== 'string' || !val) return false;
  const ms = new Date(val).getTime();
  return !Number.isNaN(ms);
}

function resolveKnownPresetName(routineId: string): string {
  const lower = routineId.toLowerCase();
  if (lower === 'minoxidil') return 'Minoxidil';
  if (lower === 'pastilla') return 'Pastilla';
  if (lower === 'dermastamp') return 'Dermastamp';
  return routineId;
}

/**
 * Función pura de migración y saneamiento del estado guardado.
 * Garantiza que reinstalar la app encima de una versión previa (v0/v1/v2 o datos parciales)
 * nunca rompa el arranque, completando campos nuevos y descartando entradas corruptas.
 */
export function migrateAndSanitizeState(raw: {
  schemaVersion?: unknown;
  settings?: unknown;
  routines?: unknown;
  blockingRules?: unknown;
  records?: unknown;
  noticeMode?: unknown;
}): PersistedAppState {
  const rawSettings =
    raw.settings && typeof raw.settings === 'object'
      ? (raw.settings as Record<string, unknown>)
      : {};

  const settings: GlobalSettings = {
    sleepTimeHHMM: isValidHHMM(rawSettings.sleepTimeHHMM)
      ? rawSettings.sleepTimeHHMM
      : DEFAULT_GLOBAL_SETTINGS.sleepTimeHHMM,
    pillMorningTimeHHMM: isValidHHMM(rawSettings.pillMorningTimeHHMM)
      ? rawSettings.pillMorningTimeHHMM
      : DEFAULT_GLOBAL_SETTINGS.pillMorningTimeHHMM,
    pillAfternoonTimeHHMM: isValidHHMM(rawSettings.pillAfternoonTimeHHMM)
      ? rawSettings.pillAfternoonTimeHHMM
      : DEFAULT_GLOBAL_SETTINGS.pillAfternoonTimeHHMM,
    dermastampWeekday:
      typeof rawSettings.dermastampWeekday === 'number' &&
      Number.isInteger(rawSettings.dermastampWeekday) &&
      rawSettings.dermastampWeekday >= 0 &&
      rawSettings.dermastampWeekday <= 6
        ? rawSettings.dermastampWeekday
        : DEFAULT_GLOBAL_SETTINGS.dermastampWeekday,
    dermastampTimeHHMM: isValidHHMM(rawSettings.dermastampTimeHHMM)
      ? rawSettings.dermastampTimeHHMM
      : DEFAULT_GLOBAL_SETTINGS.dermastampTimeHHMM,
    useTimeSensitiveEntitlement:
      typeof rawSettings.useTimeSensitiveEntitlement === 'boolean'
        ? rawSettings.useTimeSensitiveEntitlement
        : DEFAULT_GLOBAL_SETTINGS.useTimeSensitiveEntitlement,
    maxInsistenceCount:
      typeof rawSettings.maxInsistenceCount === 'number' &&
      Number.isInteger(rawSettings.maxInsistenceCount) &&
      rawSettings.maxInsistenceCount >= 0 &&
      rawSettings.maxInsistenceCount <= 30
        ? rawSettings.maxInsistenceCount
        : DEFAULT_GLOBAL_SETTINGS.maxInsistenceCount ?? 6,
    lastSideloadReinstallISO: isValidISO(rawSettings.lastSideloadReinstallISO)
      ? rawSettings.lastSideloadReinstallISO
      : undefined,
  };

  const defaultRoutines = createInitialRoutines(settings);
  const sanitizedRoutines: RoutineConfig[] = [];

  if (Array.isArray(raw.routines)) {
    for (const item of raw.routines) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== 'string' || !r.id.trim()) continue;
      if (
        typeof r.scheduleType !== 'string' ||
        !VALID_SCHEDULE_TYPES.includes(r.scheduleType as ScheduleType)
      ) {
        continue;
      }

      const presetMatch = defaultRoutines.find((d) => d.id === r.id);
      const name =
        typeof r.name === 'string' && r.name.trim()
          ? r.name.trim()
          : presetMatch?.name ?? resolveKnownPresetName(r.id);

      let secondarySchedule = presetMatch?.secondarySchedule;
      if (r.secondarySchedule && typeof r.secondarySchedule === 'object') {
        const sec = r.secondarySchedule as Record<string, unknown>;
        secondarySchedule = {
          timeHHMM: isValidHHMM(sec.timeHHMM)
            ? sec.timeHHMM
            : presetMatch?.secondarySchedule?.timeHHMM ??
              settings.pillAfternoonTimeHHMM,
          insistIntervalMinutes:
            typeof sec.insistIntervalMinutes === 'number' &&
            sec.insistIntervalMinutes > 0
              ? sec.insistIntervalMinutes
              : 10,
          insistDurationMinutes:
            typeof sec.insistDurationMinutes === 'number' &&
            sec.insistDurationMinutes > 0
              ? sec.insistDurationMinutes
              : 180,
          allowNotAtHomePostpone:
            typeof sec.allowNotAtHomePostpone === 'boolean'
              ? sec.allowNotAtHomePostpone
              : true,
          postponeDurationMinutes:
            typeof sec.postponeDurationMinutes === 'number' &&
            sec.postponeDurationMinutes > 0
              ? sec.postponeDurationMinutes
              : 60,
          maxPostponeTimeHHMM: isValidHHMM(sec.maxPostponeTimeHHMM)
            ? sec.maxPostponeTimeHHMM
            : '22:00',
        };
      }

      let checklistSteps = presetMatch?.checklistSteps;
      if (Array.isArray(r.checklistSteps)) {
        const validSteps = r.checklistSteps
          .filter(
            (s): s is { id: string; label: string } =>
              Boolean(
                s &&
                  typeof s === 'object' &&
                  typeof (s as Record<string, unknown>).id === 'string' &&
                  typeof (s as Record<string, unknown>).label === 'string'
              )
          )
          .map((s) => ({ id: s.id, label: s.label }));
        if (validSteps.length > 0) {
          checklistSteps = validSteps;
        }
      }

      sanitizedRoutines.push({
        id: r.id,
        name,
        enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
        scheduleType: r.scheduleType as ScheduleType,
        offsetBeforeSleepMinutes:
          typeof r.offsetBeforeSleepMinutes === 'number'
            ? r.offsetBeforeSleepMinutes
            : presetMatch?.offsetBeforeSleepMinutes ?? -120,
        fixedTimeHHMM: isValidHHMM(r.fixedTimeHHMM)
          ? r.fixedTimeHHMM
          : presetMatch?.fixedTimeHHMM ?? '09:00',
        weekday:
          typeof r.weekday === 'number' && r.weekday >= 0 && r.weekday <= 6
            ? r.weekday
            : presetMatch?.weekday ?? 0,
        insistIntervalMinutes:
          typeof r.insistIntervalMinutes === 'number' &&
          r.insistIntervalMinutes > 0
            ? r.insistIntervalMinutes
            : presetMatch?.insistIntervalMinutes ?? 10,
        insistDurationMinutes:
          typeof r.insistDurationMinutes === 'number' &&
          r.insistDurationMinutes > 0
            ? r.insistDurationMinutes
            : presetMatch?.insistDurationMinutes ?? 60,
        maxInsistenceCount:
          typeof r.maxInsistenceCount === 'number' && r.maxInsistenceCount >= 0
            ? r.maxInsistenceCount
            : presetMatch?.maxInsistenceCount,
        secondarySchedule,
        checklistSteps,
        allowDiscreetMode:
          typeof r.allowDiscreetMode === 'boolean'
            ? r.allowDiscreetMode
            : presetMatch?.allowDiscreetMode ?? false,
      });
    }
  }

  const routines =
    sanitizedRoutines.length > 0 ? sanitizedRoutines : defaultRoutines;
  const routineNameMap = new Map<string, string>(
    routines.map((rt) => [rt.id, rt.name])
  );

  let blockingRules: BlockingRule[] = DEFAULT_BLOCKING_RULES;
  if (Array.isArray(raw.blockingRules)) {
    const validRules: BlockingRule[] = [];
    for (const item of raw.blockingRules) {
      if (!item || typeof item !== 'object') continue;
      const br = item as Record<string, unknown>;
      if (
        typeof br.id !== 'string' ||
        typeof br.sourceRoutineId !== 'string' ||
        typeof br.targetRoutineId !== 'string' ||
        br.sourceRoutineId === br.targetRoutineId
      ) {
        continue;
      }
      if (
        !routineNameMap.has(br.sourceRoutineId) ||
        !routineNameMap.has(br.targetRoutineId)
      ) {
        continue;
      }
      const duration =
        typeof br.blockDurationHours === 'number' && br.blockDurationHours > 0
          ? br.blockDurationHours
          : 24;
      const srcName = (
        routineNameMap.get(br.sourceRoutineId) ?? br.sourceRoutineId
      ).toLowerCase();
      validRules.push({
        id: br.id,
        sourceRoutineId: br.sourceRoutineId,
        targetRoutineId: br.targetRoutineId,
        blockDurationHours: duration,
        statusLabel:
          typeof br.statusLabel === 'string' && br.statusLabel.trim()
            ? br.statusLabel
            : `omitido por ${srcName}`,
      });
    }
    blockingRules = validRules;
  }

  const records: RoutineDayRecord[] = [];
  if (Array.isArray(raw.records)) {
    for (const item of raw.records) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.routineId !== 'string' || !rec.routineId.trim()) continue;
      if (
        typeof rec.dateKey !== 'string' ||
        !VALID_DATE_KEY_REGEX.test(rec.dateKey)
      ) {
        continue;
      }
      if (
        typeof rec.status !== 'string' ||
        !VALID_RECORD_STATUSES.includes(rec.status as DayRoutineStatus)
      ) {
        continue;
      }

      const savedRoutineName =
        typeof rec.routineName === 'string' && rec.routineName.trim()
          ? rec.routineName.trim()
          : routineNameMap.get(rec.routineId) ??
            resolveKnownPresetName(rec.routineId);

      const cleanRec: RoutineDayRecord = {
        routineId: rec.routineId,
        routineName: savedRoutineName,
        dateKey: rec.dateKey,
        status: rec.status as DayRoutineStatus,
      };

      if (isValidISO(rec.completedAtISO)) {
        cleanRec.completedAtISO = rec.completedAtISO;
      }
      if (Array.isArray(rec.completedChecklistSteps)) {
        cleanRec.completedChecklistSteps = rec.completedChecklistSteps.filter(
          (s): s is string => typeof s === 'string'
        );
      }
      if (
        typeof rec.postponeCount === 'number' &&
        rec.postponeCount >= 0
      ) {
        cleanRec.postponeCount = rec.postponeCount;
      }
      if (isValidHHMM(rec.postponedPrimaryTimeHHMM)) {
        cleanRec.postponedPrimaryTimeHHMM = rec.postponedPrimaryTimeHHMM;
      }
      if (isValidISO(rec.postponedPrimaryAtISO)) {
        cleanRec.postponedPrimaryAtISO = rec.postponedPrimaryAtISO;
      }
      if (
        typeof rec.notAtHomePostponeCount === 'number' &&
        rec.notAtHomePostponeCount >= 0
      ) {
        cleanRec.notAtHomePostponeCount = rec.notAtHomePostponeCount;
      }
      if (isValidHHMM(rec.postponedAfternoonTimeHHMM)) {
        cleanRec.postponedAfternoonTimeHHMM = rec.postponedAfternoonTimeHHMM;
      }
      if (typeof rec.blockReason === 'string') {
        cleanRec.blockReason = rec.blockReason;
      }
      if (typeof rec.blockedByRoutineId === 'string') {
        cleanRec.blockedByRoutineId = rec.blockedByRoutineId;
      }

      records.push(cleanRec);
    }
  }

  let noticeMode: ActiveNoticeMode = { type: 'alarm' };
  if (raw.noticeMode && typeof raw.noticeMode === 'object') {
    const nm = raw.noticeMode as Record<string, unknown>;
    if (nm.type === 'discreet' && isValidISO(nm.untilISO)) {
      noticeMode = {
        type: 'discreet',
        startedAtISO: isValidISO(nm.startedAtISO)
          ? nm.startedAtISO
          : new Date().toISOString(),
        untilISO: nm.untilISO,
        discreetIntervalMinutes:
          typeof nm.discreetIntervalMinutes === 'number' &&
          nm.discreetIntervalMinutes > 0
            ? nm.discreetIntervalMinutes
            : 3,
      };
    } else if (nm.type === 'paused' && isValidISO(nm.untilISO)) {
      const untilDt = new Date(nm.untilISO);
      noticeMode = {
        type: 'paused',
        startedAtISO: isValidISO(nm.startedAtISO)
          ? nm.startedAtISO
          : new Date().toISOString(),
        untilISO: nm.untilISO,
        targetHHMM: isValidHHMM(nm.targetHHMM)
          ? nm.targetHHMM
          : formatHHMM(untilDt.getHours(), untilDt.getMinutes()),
      };
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings,
    routines,
    blockingRules,
    records,
    noticeMode,
  };
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    if (!value) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, data: T): Promise<void> {
  try {
    await Preferences.set({
      key,
      value: JSON.stringify(data),
    });
  } catch {
    // Evitar bloqueo si el almacenamiento nativo/local falla
  }
}

export async function loadAppState(): Promise<PersistedAppState> {
  try {
    const storedVersion = await readJson<number | null>(
      KEYS.SCHEMA_VERSION,
      null
    );
    const [rawSettings, rawRoutines, rawRules, rawRecords, rawMode] =
      await Promise.all([
        readJson<unknown>(KEYS.SETTINGS, null),
        readJson<unknown>(KEYS.ROUTINES, null),
        readJson<unknown>(KEYS.BLOCKING_RULES, null),
        readJson<unknown>(KEYS.RECORDS, null),
        readJson<unknown>(KEYS.NOTICE_MODE, null),
      ]);

    const migrated = migrateAndSanitizeState({
      schemaVersion: storedVersion ?? 1,
      settings: rawSettings,
      routines: rawRoutines,
      blockingRules: rawRules,
      records: rawRecords,
      noticeMode: rawMode,
    });

    if (storedVersion !== CURRENT_SCHEMA_VERSION) {
      await saveAppState(migrated);
    }

    return migrated;
  } catch {
    return migrateAndSanitizeState({});
  }
}

export async function saveAppState(state: PersistedAppState): Promise<void> {
  await Promise.all([
    writeJson(KEYS.SCHEMA_VERSION, CURRENT_SCHEMA_VERSION),
    writeJson(KEYS.SETTINGS, state.settings),
    writeJson(KEYS.ROUTINES, state.routines),
    writeJson(KEYS.BLOCKING_RULES, state.blockingRules),
    writeJson(KEYS.RECORDS, state.records),
    writeJson(KEYS.NOTICE_MODE, state.noticeMode),
  ]);
}

export async function getPreviouslyScheduledIds(): Promise<{
  numericIds: number[];
  alarmUuids: string[];
}> {
  const raw = await readJson<{ numericIds?: unknown; alarmUuids?: unknown }>(
    KEYS.SCHEDULED_IDS,
    { numericIds: [], alarmUuids: [] }
  );
  return {
    numericIds: Array.isArray(raw?.numericIds)
      ? raw.numericIds.filter((n): n is number => typeof n === 'number')
      : [],
    alarmUuids: Array.isArray(raw?.alarmUuids)
      ? raw.alarmUuids.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

export async function saveScheduledIds(data: {
  numericIds: number[];
  alarmUuids: string[];
}): Promise<void> {
  await writeJson(KEYS.SCHEDULED_IDS, data);
}

// @end: Preferences-Storage-Service
