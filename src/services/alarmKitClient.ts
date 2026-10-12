// @section: AlarmKit-Native-Wrapper

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AlarmKitStatus } from '../core/types';

export const ALARMKIT_PLUGIN_NAME = 'AlarmKit';
const JS_ID_TO_UUID_MAP_KEY = 'rutinas_alarmkit_js_id_uuid_map_v1';

export interface AlarmKitStatusResponse {
  available: boolean;
  authorized: boolean;
  authorizationState: 'notDetermined' | 'authorized' | 'denied' | 'unavailable' | string;
}

export interface AlarmKitScheduleInput {
  id: string;
  fechaISO: string;
  etiqueta: string;
}

export interface AlarmKitScheduleResult {
  ok: boolean;
  scheduled: boolean;
  id: string;
  uuid: string;
  scheduledAtISO: string;
  authorizationState: string;
  error?: string;
}

export interface AlarmKitCancelResult {
  ok: boolean;
  cancelled: boolean;
  id: string;
  uuid: string;
  error?: string;
}

export interface AlarmKitListedAlarm {
  id: string;
  uuid: string;
  state: string;
}

export interface AlarmKitNativePlugin {
  getStatus(): Promise<AlarmKitStatusResponse>;
  checkPermissions(): Promise<AlarmKitStatusResponse>;
  requestAuthorization(): Promise<AlarmKitStatusResponse>;
  scheduleAlarm(options: AlarmKitScheduleInput): Promise<{
    scheduled: boolean;
    id: string;
    uuid: string;
    scheduledAtISO: string;
    authorizationState: string;
  }>;
  cancelAlarm(options: { id: string }): Promise<{
    cancelled: boolean;
    id: string;
    uuid: string;
    error?: string;
  }>;
  listAlarms(): Promise<{
    alarms: AlarmKitListedAlarm[];
    count: number;
  }>;
}

const NativeAlarmKit = registerPlugin<AlarmKitNativePlugin>(ALARMKIT_PLUGIN_NAME);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convierte cualquier identificador determinista de la app en un UUID válido (formato 8-4-4-4-12)
 * y guarda la correspondencia id <-> uuid para trazabilidad en TypeScript y nativo.
 */
export function toAlarmKitUuidAndSaveMapping(appId: string): string {
  const trimmed = appId.trim();
  if (UUID_REGEX.test(trimmed)) {
    const normalized = trimmed.toLowerCase();
    saveJsIdMapping(trimmed, normalized);
    return normalized;
  }

  const existing = getJsIdMapping()[trimmed];
  if (existing && UUID_REGEX.test(existing)) {
    return existing;
  }

  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const hexParts = seeds.map((seed, idx) => {
    let h = seed ^ (idx * 0x27d4eb2d);
    for (let i = 0; i < trimmed.length; i++) {
      h ^= trimmed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  });

  const raw = hexParts.join('');
  const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-5${raw.slice(
    13,
    16
  )}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`.toLowerCase();

  saveJsIdMapping(trimmed, uuid);
  return uuid;
}

export function getJsIdMapping(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(JS_ID_TO_UUID_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveJsIdMapping(appId: string, uuid: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const map = getJsIdMapping();
    map[appId] = uuid;
    localStorage.setItem(JS_ID_TO_UUID_MAP_KEY, JSON.stringify(map));
  } catch {
    // Fallback silencioso si localStorage no está disponible
  }
}

function removeJsIdMapping(appId: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const map = getJsIdMapping();
    delete map[appId];
    localStorage.setItem(JS_ID_TO_UUID_MAP_KEY, JSON.stringify(map));
  } catch {
    // Fallback silencioso
  }
}

export function isAlarmKitPluginAvailable(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.isPluginAvailable(ALARMKIT_PLUGIN_NAME)
    );
  } catch {
    return false;
  }
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const maybeMsg = (err as Record<string, unknown>).message ?? (err as Record<string, unknown>).errorMessage;
    if (typeof maybeMsg === 'string' && maybeMsg) return maybeMsg;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Consulta la disponibilidad y autorización real de AlarmKit en el dispositivo.
 * En navegador o si el plugin no está presente devuelve `{ available: false, authorized: false, authorizationState: 'unavailable' }`.
 */
export async function getAlarmKitNativeStatus(): Promise<
  AlarmKitStatus & { authorizationState: string; error?: string }
> {
  if (!isAlarmKitPluginAvailable()) {
    return {
      available: false,
      authorized: false,
      authorizationState: 'unavailable',
    };
  }

  try {
    const res = await NativeAlarmKit.getStatus();
    return {
      available: Boolean(res?.available),
      authorized: Boolean(res?.authorized),
      authorizationState: String(res?.authorizationState ?? 'unknown'),
    };
  } catch (err) {
    return {
      available: false,
      authorized: false,
      authorizationState: 'error',
      error: extractErrorMessage(err),
    };
  }
}

/**
 * Solicita permiso explícito de AlarmKit (`AlarmManager.shared.requestAuthorization()`).
 */
export async function requestAlarmKitAuthorization(): Promise<
  AlarmKitStatus & { authorizationState: string; error?: string }
> {
  if (!isAlarmKitPluginAvailable()) {
    return {
      available: false,
      authorized: false,
      authorizationState: 'unavailable',
      error: 'Plugin AlarmKit no disponible en este entorno (web o iOS < 26).',
    };
  }

  try {
    const res = await NativeAlarmKit.requestAuthorization();
    return {
      available: Boolean(res?.available),
      authorized: Boolean(res?.authorized),
      authorizationState: String(res?.authorizationState ?? 'unknown'),
    };
  } catch (err) {
    return {
      available: true,
      authorized: false,
      authorizationState: 'error',
      error: extractErrorMessage(err),
    };
  }
}

/**
 * Programa una alarma única con fecha fija (`Alarm.Schedule.fixed`) en AlarmKit.
 */
export async function scheduleAlarmKitAlarm(
  input: AlarmKitScheduleInput
): Promise<AlarmKitScheduleResult> {
  const fallbackUuid = toAlarmKitUuidAndSaveMapping(input.id);

  if (!isAlarmKitPluginAvailable()) {
    return {
      ok: false,
      scheduled: false,
      id: input.id,
      uuid: fallbackUuid,
      scheduledAtISO: input.fechaISO,
      authorizationState: 'unavailable',
      error: 'Plugin AlarmKit no disponible en este entorno (ejecutando en navegador o iOS < 26).',
    };
  }

  try {
    const res = await NativeAlarmKit.scheduleAlarm({
      id: input.id,
      fechaISO: input.fechaISO,
      etiqueta: input.etiqueta,
    });
    if (res?.uuid) {
      saveJsIdMapping(input.id, res.uuid);
    }
    return {
      ok: Boolean(res?.scheduled),
      scheduled: Boolean(res?.scheduled),
      id: res?.id ?? input.id,
      uuid: res?.uuid ?? fallbackUuid,
      scheduledAtISO: res?.scheduledAtISO ?? input.fechaISO,
      authorizationState: res?.authorizationState ?? 'authorized',
    };
  } catch (err) {
    return {
      ok: false,
      scheduled: false,
      id: input.id,
      uuid: fallbackUuid,
      scheduledAtISO: input.fechaISO,
      authorizationState: 'error',
      error: extractErrorMessage(err),
    };
  }
}

/**
 * Cancela una alarma programada en AlarmKit a partir del id de la app o UUID.
 */
export async function cancelAlarmKitAlarm(input: {
  id: string;
}): Promise<AlarmKitCancelResult> {
  const mappedUuid = toAlarmKitUuidAndSaveMapping(input.id);

  if (!isAlarmKitPluginAvailable()) {
    removeJsIdMapping(input.id);
    return {
      ok: false,
      cancelled: false,
      id: input.id,
      uuid: mappedUuid,
      error: 'Plugin AlarmKit no disponible en este entorno.',
    };
  }

  try {
    const res = await NativeAlarmKit.cancelAlarm({ id: input.id });
    removeJsIdMapping(input.id);
    return {
      ok: Boolean(res?.cancelled),
      cancelled: Boolean(res?.cancelled),
      id: res?.id ?? input.id,
      uuid: res?.uuid ?? mappedUuid,
      error: res?.error,
    };
  } catch (err) {
    return {
      ok: false,
      cancelled: false,
      id: input.id,
      uuid: mappedUuid,
      error: extractErrorMessage(err),
    };
  }
}

/**
 * Devuelve la lista de alarmas activas actualmente en `AlarmManager.shared.alarms`.
 */
export async function listAlarmKitAlarms(): Promise<{
  ok: boolean;
  alarms: AlarmKitListedAlarm[];
  error?: string;
}> {
  if (!isAlarmKitPluginAvailable()) {
    return { ok: false, alarms: [] };
  }

  try {
    const res = await NativeAlarmKit.listAlarms();
    return {
      ok: true,
      alarms: Array.isArray(res?.alarms) ? res.alarms : [],
    };
  } catch (err) {
    return {
      ok: false,
      alarms: [],
      error: extractErrorMessage(err),
    };
  }
}

// @end: AlarmKit-Native-Wrapper
