// @section: Defaults-And-Preset-Rules

import type { BlockingRule, GlobalSettings, RoutineConfig } from './types';

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  sleepTimeHHMM: '00:00',
  pillMorningTimeHHMM: '09:00',
  pillAfternoonTimeHHMM: '15:30',
  dermastampWeekday: 0, // Domingo
  dermastampTimeHHMM: '20:00',
  useTimeSensitiveEntitlement: false,
};

export function createInitialRoutines(
  settings: GlobalSettings = DEFAULT_GLOBAL_SETTINGS
): RoutineConfig[] {
  return [
    {
      id: 'minoxidil',
      name: 'Minoxidil',
      enabled: true,
      scheduleType: 'relative_to_sleep',
      offsetBeforeSleepMinutes: -120, // Hora de dormir - 2 horas
      insistIntervalMinutes: 10,
      insistDurationMinutes: 180, // Insiste cada 10 min hasta marcar hecho
      allowDiscreetMode: false, // Por defecto siempre alarma
    },
    {
      id: 'pastilla',
      name: 'Pastilla',
      enabled: true,
      scheduleType: 'fixed_daily',
      fixedTimeHHMM: settings.pillMorningTimeHHMM, // Por defecto 09:00
      insistIntervalMinutes: 10,
      insistDurationMinutes: 60, // Insiste cada 10 min durante 1 hora
      secondarySchedule: {
        timeHHMM: settings.pillAfternoonTimeHHMM, // Por defecto 15:30
        insistIntervalMinutes: 10,
        insistDurationMinutes: 180,
        allowNotAtHomePostpone: true,
        postponeDurationMinutes: 60, // Pospone 1 hora
        maxPostponeTimeHHMM: '22:00', // Límite máximo 22:00
      },
      allowDiscreetMode: false, // Por defecto siempre alarma
    },
    {
      id: 'dermastamp',
      name: 'Dermastamp',
      enabled: true,
      scheduleType: 'weekly',
      weekday: settings.dermastampWeekday,
      fixedTimeHHMM: settings.dermastampTimeHHMM,
      insistIntervalMinutes: 10,
      insistDurationMinutes: 120,
      checklistSteps: [
        {
          id: 'disinfect',
          label: 'Desinfectar el dermastamp antes de usarlo',
        },
        {
          id: 'applied',
          label: 'Aplicado',
        },
      ],
      allowDiscreetMode: false, // Por defecto siempre alarma
    },
  ];
}

export const DEFAULT_BLOCKING_RULES: BlockingRule[] = [
  {
    id: 'block-dermastamp-minoxidil-24h',
    sourceRoutineId: 'dermastamp',
    targetRoutineId: 'minoxidil',
    blockDurationHours: 24,
    statusLabel: 'omitido por dermastamp',
  },
];

// @end: Defaults-And-Preset-Rules
