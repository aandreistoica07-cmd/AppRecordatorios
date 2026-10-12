// @section: Deterministic-IDs

import type { PromptKind } from './types';

/**
 * Construye un identificador en texto 100% determinista a partir de:
 * tarea + fecha + tipo + índice de insistencia.
 */
export function buildDeterministicStringId(
  routineId: string,
  dateKey: string,
  kind: PromptKind,
  index: number = 0
): string {
  return `${routineId}__${dateKey}__${kind}__${index}`;
}

/**
 * Convierte cualquier string determinista en un entero positivo de 31 bits (1 .. 2147483647)
 * apto para `@capacitor/local-notifications` sin colisiones triviales (FNV-1a 32-bit).
 */
export function toDeterministicNumericId(deterministicString: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < deterministicString.length; i++) {
    hash ^= deterministicString.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const positive31Bit = (hash >>> 0) & 0x7fffffff;
  return positive31Bit === 0 ? 1 : positive31Bit;
}

/**
 * Convierte un string determinista en un UUID formato RFC 4122 (xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx)
 * determinista para que `AlarmKit` (que exige `UUID` en Swift) pueda cancelar y reprogramar
 * exactamente la misma alarma sin almacenar mapeos aleatorios.
 */
export function toDeterministicUuid(deterministicString: string): string {
  const h1 = fnv1aHex(deterministicString + ':part1');
  const h2 = fnv1aHex(deterministicString + ':part2');
  const h3 = fnv1aHex(deterministicString + ':part3');
  const h4 = fnv1aHex(deterministicString + ':part4');
  const raw = (h1 + h2 + h3 + h4).padEnd(32, '0').slice(0, 32);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// @end: Deterministic-IDs
