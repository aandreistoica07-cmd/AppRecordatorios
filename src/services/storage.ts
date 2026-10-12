// @section: Preferences-Storage-Service

import { Preferences } from '@capacitor/preferences';
import {
  DEFAULT_BLOCKING_RULES,
  DEFAULT_GLOBAL_SETTINGS,
  createInitialRoutines,
} from '../core/defaults';
import type {
  ActiveNoticeMode,
  BlockingRule,
  GlobalSettings,
  RoutineConfig,
  RoutineDayRecord,
} from '../core/types';

const KEYS = {
  SETTINGS: 'rutinas_settings_v1',
  ROUTINES: 'rutinas_configs_v1',
  BLOCKING_RULES: 'rutinas_blocking_rules_v1',
  RECORDS: 'rutinas_records_v1',
  NOTICE_MODE: 'rutinas_notice_mode_v1',
  SCHEDULED_IDS: 'rutinas_scheduled_ids_v1',
};

export interface PersistedAppState {
  settings: GlobalSettings;
  routines: RoutineConfig[];
  blockingRules: BlockingRule[];
  records: RoutineDayRecord[];
  noticeMode: ActiveNoticeMode;
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
  await Preferences.set({
    key,
    value: JSON.stringify(data),
  });
}

export async function loadAppState(): Promise<PersistedAppState> {
  const rawSettings = await readJson<GlobalSettings>(
    KEYS.SETTINGS,
    DEFAULT_GLOBAL_SETTINGS
  );
  const settings: GlobalSettings = {
    ...DEFAULT_GLOBAL_SETTINGS,
    ...(rawSettings && typeof rawSettings === 'object' ? rawSettings : {}),
  };

  const defaultRoutines = createInitialRoutines(settings);
  const rawRoutines = await readJson<RoutineConfig[]>(
    KEYS.ROUTINES,
    defaultRoutines
  );
  const routines =
    Array.isArray(rawRoutines) &&
    rawRoutines.length > 0 &&
    rawRoutines.every(
      (r) => r && typeof r.id === 'string' && typeof r.scheduleType === 'string'
    )
      ? rawRoutines
      : defaultRoutines;

  const rawRules = await readJson<BlockingRule[]>(
    KEYS.BLOCKING_RULES,
    DEFAULT_BLOCKING_RULES
  );
  const blockingRules = Array.isArray(rawRules)
    ? rawRules
    : DEFAULT_BLOCKING_RULES;

  const rawRecords = await readJson<RoutineDayRecord[]>(KEYS.RECORDS, []);
  const records = Array.isArray(rawRecords) ? rawRecords : [];

  const rawMode = await readJson<ActiveNoticeMode>(KEYS.NOTICE_MODE, {
    type: 'alarm',
  });
  const noticeMode: ActiveNoticeMode =
    rawMode &&
    typeof rawMode === 'object' &&
    (rawMode.type === 'alarm' ||
      (rawMode.type === 'discreet' && typeof rawMode.untilISO === 'string') ||
      (rawMode.type === 'paused' && typeof rawMode.untilISO === 'string'))
      ? rawMode
      : { type: 'alarm' };

  return {
    settings,
    routines,
    blockingRules,
    records,
    noticeMode,
  };
}

export async function saveAppState(state: PersistedAppState): Promise<void> {
  await Promise.all([
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
  return readJson(KEYS.SCHEDULED_IDS, { numericIds: [], alarmUuids: [] });
}

export async function saveScheduledIds(data: {
  numericIds: number[];
  alarmUuids: string[];
}): Promise<void> {
  await writeJson(KEYS.SCHEDULED_IDS, data);
}

// @end: Preferences-Storage-Service
