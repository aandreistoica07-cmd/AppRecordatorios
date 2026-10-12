// @section: Unit-Tests-Scheduler

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCKING_RULES,
  DEFAULT_GLOBAL_SETTINGS,
  createInitialRoutines,
} from '../defaults';
import {
  buildDateFromKeyAndHHMM,
  computeCurrentStreakDays,
  computeDueProgressForDay,
  computeSchedule,
  computeSideloadSignatureStatus,
  computeWeeklyCompliancePercentage,
  deleteRoutineAndCleanup,
  evaluateDaySummary,
  markRoutineDone,
  postponeRoutineTask,
  resetRoutinePostpone,
  resolveRoutinePrimaryHHMM,
  toggleChecklistStep,
  unmarkRoutineDone,
} from '../scheduler';
import {
  CURRENT_SCHEMA_VERSION,
  migrateAndSanitizeState,
} from '../../services/storage';
import type { ActiveNoticeMode, GlobalSettings, RoutineDayRecord } from '../types';

describe('Motor puro de rutinas, bloqueos 24h, posposición y modos', () => {
  it('(1) Bloqueo del dermastamp: cancela SOLO las alarmas dentro de las 24 h exactas desde la hora real de marcado, NO el día natural entero', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      sleepTimeHHMM: '00:00', // Minoxidil a las 22:00
    };
    const routines = createInitialRoutines(settings);

    // Escenario A: Dermastamp marcado el 2026-10-11 a las 19:30.
    // Ventana exacta de 24h: (2026-10-11 19:30, 2026-10-12 19:30].
    // - Minoxidil del 2026-10-11 a las 22:00 (+2.5h) -> BLOQUEADO.
    // - Minoxidil del 2026-10-12 a las 22:00 (+26.5h, mismo día siguiente pero fuera de las 24h) -> NO BLOQUEADO (activo).
    const dermastampCompletedAt = buildDateFromKeyAndHHMM('2026-10-11', '19:30');
    const records: RoutineDayRecord[] = [
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: dermastampCompletedAt.toISOString(),
        completedChecklistSteps: ['disinfect', 'applied'],
      },
    ];

    const result = computeSchedule({
      now: dermastampCompletedAt,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records,
      settings,
      noticeMode: { type: 'alarm' },
    });

    const minoxDay1 = result.upcomingSevenDaysOverview.find(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-11'
    );
    const minoxDay2 = result.upcomingSevenDaysOverview.find(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-12'
    );

    expect(minoxDay1?.blocked).toBe(true);
    expect(minoxDay1?.blockedReason).toBe('omitido por dermastamp');
    // El día siguiente a las 22:00 han pasado 26h30m (> 24h), por lo que NO debe bloquearse
    expect(minoxDay2?.blocked).toBe(false);

    // Ninguna alarma ni insistencia activa de minoxidil para el 2026-10-11, pero SÍ para el 2026-10-12
    const activeMinoxDay1 = result.activePromptsToSchedule.filter(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-11'
    );
    const activeMinoxDay2 = result.activePromptsToSchedule.filter(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-12'
    );
    expect(activeMinoxDay1).toHaveLength(0);
    expect(activeMinoxDay2.length).toBeGreaterThan(0);
  });

  it('(2) Dermastamp marcado a las 21:00 con minoxidil a las 22:00 ese día y al día siguiente', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      sleepTimeHHMM: '00:00', // Minoxidil = 00:00 - 2h = 22:00
    };
    const routines = createInitialRoutines(settings);

    // Dermastamp marcado el 2026-10-11 a las 21:00.
    // Ventana de bloqueo de 24h exactas: (2026-10-11 21:00, 2026-10-12 21:00].
    // - Ese mismo día (2026-10-11) a las 22:00 (+1h) -> Cae DENTRO de las 24h -> BLOQUEADO y registrado como 'omitido por dermastamp'.
    // - Al día siguiente (2026-10-12) a las 22:00 (+25h) -> Cae FUERA de las 24h -> NO BLOQUEADO (suena normal a las 22:00).
    const markedAt21 = buildDateFromKeyAndHHMM('2026-10-11', '21:00');
    const records: RoutineDayRecord[] = [
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: markedAt21.toISOString(),
        completedChecklistSteps: ['disinfect', 'applied'],
      },
    ];

    const result = computeSchedule({
      now: markedAt21,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records,
      settings,
      noticeMode: { type: 'alarm' },
    });

    const sameDayMinox = result.upcomingSevenDaysOverview.find(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-11'
    );
    const nextDayMinox = result.upcomingSevenDaysOverview.find(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-12'
    );

    expect(sameDayMinox?.blocked).toBe(true);
    expect(nextDayMinox?.blocked).toBe(false);

    // Se genera el registro auto-omitido únicamente para el 2026-10-11
    expect(result.autoOmittedRecords).toEqual([
      {
        routineId: 'minoxidil',
        dateKey: '2026-10-11',
        status: 'omitted_by_block',
        blockReason: 'omitido por dermastamp',
        blockedByRoutineId: 'dermastamp',
      },
    ]);

    // Caso complementario: si el dermastamp se marcara a las 22:30 (después de las 22:00),
    // las 24h cubren hasta las 22:30 del día siguiente, bloqueando el minoxidil del día siguiente (22:00, +23.5h).
    const markedAt2230 = buildDateFromKeyAndHHMM('2026-10-11', '22:30');
    const resultLate = computeSchedule({
      now: markedAt2230,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [
        {
          routineId: 'dermastamp',
          dateKey: '2026-10-11',
          status: 'completed',
          completedAtISO: markedAt2230.toISOString(),
        },
      ],
      settings,
      noticeMode: { type: 'alarm' },
    });
    const nextDayFrom2230 = resultLate.upcomingSevenDaysOverview.find(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-12'
    );
    expect(nextDayFrom2230?.blocked).toBe(true);
  });

  it('(3) Minoxidil YA marcado antes de marcar el dermastamp: conserva su estado "completed" y no pasa a omitido', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      sleepTimeHHMM: '00:00', // Minoxidil 22:00
    };
    const routines = createInitialRoutines(settings);

    // El usuario se aplica y marca Minoxidil temprano (ej. a las 20:00 del 2026-10-11)
    // y luego a las 21:00 marca el Dermastamp.
    const minoxDoneAt = buildDateFromKeyAndHHMM('2026-10-11', '20:00');
    const dermastampDoneAt = buildDateFromKeyAndHHMM('2026-10-11', '21:00');

    const records: RoutineDayRecord[] = [
      {
        routineId: 'minoxidil',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: minoxDoneAt.toISOString(),
      },
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: dermastampDoneAt.toISOString(),
        completedChecklistSteps: ['disinfect', 'applied'],
      },
    ];

    const result = computeSchedule({
      now: dermastampDoneAt,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records,
      settings,
      noticeMode: { type: 'alarm' },
    });

    // No debe sobrescribir el minoxidil del 2026-10-11 como 'omitted_by_block' porque ya estaba 'completed'
    expect(
      result.autoOmittedRecords.find(
        (r) => r.routineId === 'minoxidil' && r.dateKey === '2026-10-11'
      )
    ).toBeUndefined();

    // Tampoco debe tener alarmas activas ese día porque ya está hecho
    expect(
      result.activePromptsToSchedule.filter(
        (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-11'
      )
    ).toHaveLength(0);
  });

  it('(4) Hora de dormir 02:00 y 23:00: reprograma Minoxidil a las 00:00 y a las 21:00 respectivamente', () => {
    const settings0200: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      sleepTimeHHMM: '02:00',
    };
    const settings2300: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      sleepTimeHHMM: '23:00',
    };

    const routines = createInitialRoutines(settings0200);
    const minoxidil = routines.find((r) => r.id === 'minoxidil')!;

    // 02:00 - 2h = 00:00
    expect(resolveRoutinePrimaryHHMM(minoxidil, settings0200)).toBe('00:00');
    // 23:00 - 2h = 21:00
    expect(resolveRoutinePrimaryHHMM(minoxidil, settings2300)).toBe('21:00');

    const now = buildDateFromKeyAndHHMM('2026-10-12', '08:00');

    const sched0200 = computeSchedule({
      now,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [],
      settings: settings0200,
      noticeMode: { type: 'alarm' },
    });
    const minoxTomorrow0200 = sched0200.upcomingSevenDaysOverview.find(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-13'
    )!;
    const d0200 = new Date(minoxTomorrow0200.scheduledAtISO);
    expect(d0200.getHours()).toBe(0);
    expect(d0200.getMinutes()).toBe(0);

    const sched2300 = computeSchedule({
      now,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [],
      settings: settings2300,
      noticeMode: { type: 'alarm' },
    });
    const minoxToday2300 = sched2300.upcomingSevenDaysOverview.find(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-12'
    )!;
    const d2300 = new Date(minoxToday2300.scheduledAtISO);
    expect(d2300.getHours()).toBe(21);
    expect(d2300.getMinutes()).toBe(0);
  });

  it('(5) Posponer genérico en la pastilla de la tarde (15:30): soporta +1h/+2h/+4h/hora concreta con tope en la hora de dormir y mantiene compatibilidad con datos heredados de "No estoy en casa"', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      sleepTimeHHMM: '22:00', // Tope hora de dormir = 22:00
    };
    const routines = createInitialRoutines(settings);
    const pillRoutine = routines.find((r) => r.id === 'pastilla')!;
    const dateKey = '2026-10-12';

    let record: RoutineDayRecord | undefined = undefined;
    const expectedTimes = [
      '16:30', // 1ª pulsación (15:30 + 1h)
      '17:30', // 2ª pulsación
      '18:30', // 3ª pulsación
      '19:30', // 4ª pulsación
      '20:30', // 5ª pulsación
      '21:30', // 6ª pulsación
      '22:00', // 7ª pulsación (21:30 + 1h = 22:30 -> truncado al tope de dormir 22:00)
      '22:00', // 8ª pulsación (se mantiene clavado en el tope de dormir 22:00)
    ];

    let callClock = buildDateFromKeyAndHHMM(dateKey, '15:30');

    for (let i = 0; i < expectedTimes.length; i++) {
      const res = postponeRoutineTask({
        routine: pillRoutine,
        existingRecord: record,
        dateKey,
        now: callClock,
        settings,
        mode: { type: 'add_hours', hours: 1 },
      });
      record = res.record;
      expect(res.nextTimeHHMM).toBe(expectedTimes[i]);
      if (i < 6) {
        expect(res.reachedCap).toBe(false);
      } else {
        expect(res.reachedCap).toBe(true);
      }
      callClock = buildDateFromKeyAndHHMM(dateKey, res.nextTimeHHMM);
    }

    expect(record?.postponeCount).toBe(8);
    expect(record?.postponedPrimaryTimeHHMM).toBe('22:00');
    expect(record?.postponedAfternoonTimeHHMM).toBe('22:00');

    // Compatibilidad con registros ya guardados que tenían una posposición hecha con el antiguo "No estoy en casa":
    const migrated = migrateAndSanitizeState({
      schemaVersion: 2,
      settings,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [
        {
          routineId: 'pastilla',
          dateKey,
          status: 'pending',
          notAtHomePostponeCount: 2,
          postponedAfternoonTimeHHMM: '17:30',
        },
      ],
      noticeMode: { type: 'alarm' },
    });
    const migratedRec = migrated.records[0];
    expect(migratedRec.postponedPrimaryTimeHHMM).toBe('17:30');
    expect(migratedRec.postponedAfternoonTimeHHMM).toBe('17:30');
    expect(migratedRec.postponeCount).toBe(2);

    // Y si sobre ese registro migrado se vuelve a posponer +2 h, pasa a las 19:30 respetando el estado previo
    const nextFromLegacy = postponeRoutineTask({
      routine: pillRoutine,
      existingRecord: migratedRec,
      dateKey,
      now: buildDateFromKeyAndHHMM(dateKey, '17:30'),
      settings,
      mode: { type: 'add_hours', hours: 2 },
    });
    expect(nextFromLegacy.nextTimeHHMM).toBe('19:30');
    expect(nextFromLegacy.record.postponeCount).toBe(3);
  });

  it('(6) Checklist de 2 pasos del Dermastamp: impide completar paso 2 sin el paso 1 y Modo Discreto que caduca vuelve a modo alarma', () => {
    const routines = createInitialRoutines(DEFAULT_GLOBAL_SETTINGS);
    const dermastamp = routines.find((r) => r.id === 'dermastamp')!;
    const now = buildDateFromKeyAndHHMM('2026-10-11', '20:05');

    // Intentar marcar paso 2 ("applied") directamente debe dar error
    const attemptStep2 = toggleChecklistStep(
      dermastamp,
      undefined,
      '2026-10-11',
      'applied',
      now
    );
    expect(attemptStep2.error).toBeDefined();
    expect(attemptStep2.record.status).toBe('pending');

    // Marcar paso 1 ("disinfect") y luego paso 2 ("applied") completa la tarea
    const step1 = toggleChecklistStep(
      dermastamp,
      undefined,
      '2026-10-11',
      'disinfect',
      now
    );
    expect(step1.error).toBeUndefined();
    expect(step1.record.status).toBe('pending');

    const step2 = toggleChecklistStep(
      dermastamp,
      step1.record,
      '2026-10-11',
      'applied',
      now
    );
    expect(step2.error).toBeUndefined();
    expect(step2.record.status).toBe('completed');

    // Modo discreto que caduca:
    // Si el modo discreto estaba activo de 10:00 a 12:00 y consultamos a las 12:01, effectiveMode vuelve a 'alarm'
    const expiredDiscreet: ActiveNoticeMode = {
      type: 'discreet',
      startedAtISO: buildDateFromKeyAndHHMM('2026-10-12', '10:00').toISOString(),
      untilISO: buildDateFromKeyAndHHMM('2026-10-12', '12:00').toISOString(),
      discreetIntervalMinutes: 3,
    };

    const schedAfterExpiry = computeSchedule({
      now: buildDateFromKeyAndHHMM('2026-10-12', '12:01'),
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [],
      settings: DEFAULT_GLOBAL_SETTINGS,
      noticeMode: expiredDiscreet,
    });
    expect(schedAfterExpiry.effectiveMode.type).toBe('alarm');
  });

  it('(7) Racha y % de cumplimiento: "omitido por dermastamp" NO rompe la racha ni cuenta como fallo', () => {
    const settings = DEFAULT_GLOBAL_SETTINGS;
    const routines = createInitialRoutines(settings);

    // Días 2026-10-10 y 2026-10-11:
    // 2026-10-10 (Sábado): Pastilla hecha, Minoxidil hecho.
    // 2026-10-11 (Domingo): Pastilla hecha, Dermastamp hecho a las 21:00 -> Minoxidil omitido por dermastamp.
    const records: RoutineDayRecord[] = [
      {
        routineId: 'pastilla',
        dateKey: '2026-10-10',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-10', '09:05').toISOString(),
      },
      {
        routineId: 'minoxidil',
        dateKey: '2026-10-10',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-10', '22:05').toISOString(),
      },
      {
        routineId: 'pastilla',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '09:05').toISOString(),
      },
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '21:00').toISOString(),
        completedChecklistSteps: ['disinfect', 'applied'],
      },
    ];

    const streak = computeCurrentStreakDays(
      '2026-10-11',
      routines,
      records,
      DEFAULT_BLOCKING_RULES,
      settings
    );
    expect(streak).toBe(2);

    const compliance = computeWeeklyCompliancePercentage(
      '2026-10-11',
      routines.filter((r) => r.id === 'minoxidil' || r.id === 'dermastamp'),
      records,
      DEFAULT_BLOCKING_RULES,
      settings
    );
    expect(compliance.omittedCount).toBe(1);
    // El omitido no penaliza el denominador
    expect(compliance.completedCount).toBe(2); // minoxidil del 10 + dermastamp del 11
  });

  it('(8) Porcentaje de cumplimiento y recuento "Hechas X/Y" solo cuentan alarmas ya vencidas (hora pasada), nunca las futuras: 2 hechas de 2 vencidas hoy = 100%', async () => {
    const { computeDueProgressForDay } = await import('../scheduler');
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      pillMorningTimeHHMM: '09:00',
      dermastampWeekday: 0, // Domingo
      dermastampTimeHHMM: '14:00',
      sleepTimeHHMM: '00:00', // Minoxidil a las 22:00 (futura a las 16:00)
    };
    const routines = createInitialRoutines(settings);

    // Domingo 2026-10-11 a las 16:00:
    // - Pastilla (09:00): ya vencida y HECHA.
    // - Dermastamp (14:00): ya vencida y HECHA (a las 14:05; nota: ponemos sin bloqueo sobre otra tarea vencida para probar 2 hechas de 2 vencidas y 1 futura a las 22:00 sin bloquear).
    const now1600 = buildDateFromKeyAndHHMM('2026-10-11', '16:00');
    const records: RoutineDayRecord[] = [
      {
        routineId: 'pastilla',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '09:05').toISOString(),
      },
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '14:05').toISOString(),
        completedChecklistSteps: ['disinfect', 'applied'],
      },
    ];

    // Probamos sin reglas de bloqueo para que la 3ª rutina del día (Minoxidil 22:00) esté pendiente y futura:
    const progress = computeDueProgressForDay(
      now1600,
      routines,
      records,
      [],
      settings
    );

    expect(progress.completedDueCount).toBe(2);
    expect(progress.totalDueCount).toBe(2);
    expect(progress.upcomingFutureCount).toBe(1); // Minoxidil de las 22:00 es futura
    expect(progress.percentage).toBe(100); // 2 hechas de 2 vencidas hoy = 100%

    // Y si una de las 2 vencidas NO está hecha a las 16:00, entonces es 1/2 = 50% (la futura de las 22:00 sigue sin contar)
    const partialProgress = computeDueProgressForDay(
      now1600,
      routines,
      [records[0]],
      [],
      settings
    );
    expect(partialProgress.completedDueCount).toBe(1);
    expect(partialProgress.totalDueCount).toBe(2);
    expect(partialProgress.percentage).toBe(50);
  });

  it('(9) Cumplimiento semanal con 2 hechas de 2 vencidas hasta ahora da 100% (nunca cuenta futuras ni días previos sin historial)', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      pillMorningTimeHHMM: '09:00',
      dermastampWeekday: 0, // Domingo
      dermastampTimeHHMM: '14:00',
      sleepTimeHHMM: '00:00', // Minoxidil a las 22:00 (futura a las 16:00)
    };
    const routines = createInitialRoutines(settings);
    const now1600 = buildDateFromKeyAndHHMM('2026-10-11', '16:00');

    const records: RoutineDayRecord[] = [
      {
        routineId: 'pastilla',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '09:05').toISOString(),
      },
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '14:05').toISOString(),
        completedChecklistSteps: ['disinfect', 'applied'],
      },
    ];

    const weekly = computeWeeklyCompliancePercentage(
      now1600,
      routines,
      records,
      [],
      settings
    );

    expect(weekly.completedCount).toBe(2);
    expect(weekly.evaluableCount).toBe(2);
    expect(weekly.percentage).toBe(100);
  });

  it('(10) Cumplimiento semanal con alarmas vencidas hechas y un día con minoxidil omitido por dermastamp da 100%', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      pillMorningTimeHHMM: '09:00',
      dermastampWeekday: 0, // Domingo
      dermastampTimeHHMM: '20:00',
      sleepTimeHHMM: '00:00', // Minoxidil 22:00
    };
    const routines = createInitialRoutines(settings);

    // Domingo 2026-10-11: Pastilla (09:00) hecha, Dermastamp (20:00) hecho a las 21:00 -> bloquea Minoxidil de las 22:00 del domingo
    // Lunes 2026-10-12 a las 12:00: Pastilla (09:00) hecha, Minoxidil (22:00) aún futura
    const nowMondayNoon = buildDateFromKeyAndHHMM('2026-10-12', '12:00');
    const records: RoutineDayRecord[] = [
      {
        routineId: 'pastilla',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '09:05').toISOString(),
      },
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '21:00').toISOString(),
        completedChecklistSteps: ['disinfect', 'applied'],
      },
      {
        routineId: 'pastilla',
        dateKey: '2026-10-12',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-12', '09:10').toISOString(),
      },
    ];

    const weekly = computeWeeklyCompliancePercentage(
      nowMondayNoon,
      routines,
      records,
      DEFAULT_BLOCKING_RULES,
      settings
    );

    expect(weekly.omittedCount).toBe(1); // Minoxidil del domingo omitido por dermastamp
    expect(weekly.completedCount).toBe(3); // Pastilla dom + Dermastamp dom + Pastilla lun
    expect(weekly.evaluableCount).toBe(3); // El omitido y la futura de las 22:00 del lunes no penalizan
    expect(weekly.percentage).toBe(100);
  });

  it('(11) Deshacer dermastamp restaura el minoxidil omitido dentro de la ventana de 24 h a pendiente y reprograma sus alarmas', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      dermastampWeekday: 0, // Domingo
      dermastampTimeHHMM: '19:30',
      sleepTimeHHMM: '00:00', // Minoxidil a las 22:00
    };
    const routines = createInitialRoutines(settings);
    const dermastampRoutine = routines.find((r) => r.id === 'dermastamp')!;

    // El domingo 2026-10-11 a las 20:00 el usuario completa los 2 pasos del Dermastamp
    const doneAt = buildDateFromKeyAndHHMM('2026-10-11', '20:00');
    const step1 = toggleChecklistStep(
      dermastampRoutine,
      undefined,
      '2026-10-11',
      'disinfect',
      doneAt
    );
    const step2 = toggleChecklistStep(
      dermastampRoutine,
      step1.record,
      '2026-10-11',
      'applied',
      doneAt
    );
    expect(step2.record.status).toBe('completed');

    // Al calcular el horario tras marcar Dermastamp, Minoxidil del 2026-10-11 (22:00) queda bloqueado y auto-omitido
    const scheduleWhileDone = computeSchedule({
      now: doneAt,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [step2.record],
      settings,
      noticeMode: { type: 'alarm' },
    });
    expect(scheduleWhileDone.autoOmittedRecords).toHaveLength(1);
    expect(scheduleWhileDone.autoOmittedRecords[0].routineId).toBe('minoxidil');
    expect(scheduleWhileDone.autoOmittedRecords[0].status).toBe('omitted_by_block');

    const recordsWithAutoOmitted: RoutineDayRecord[] = [
      step2.record,
      ...scheduleWhileDone.autoOmittedRecords,
    ];

    // Ahora el usuario deshace el Dermastamp a las 20:05
    const updatedRecords = unmarkRoutineDone(
      'dermastamp',
      '2026-10-11',
      recordsWithAutoOmitted,
      routines,
      DEFAULT_BLOCKING_RULES,
      settings
    );

    const unmarkedRecord = updatedRecords.find(
      (r) => r.routineId === 'dermastamp' && r.dateKey === '2026-10-11'
    );
    expect(unmarkedRecord?.status).toBe('pending');
    expect(unmarkedRecord?.completedAtISO).toBeUndefined();
    expect(unmarkedRecord?.completedChecklistSteps).toEqual([]);

    // El registro omitted_by_block de minoxidil ha sido eliminado y vuelve a estar pendiente
    const minoxRecordAfterUndo = updatedRecords.find(
      (r) => r.routineId === 'minoxidil' && r.dateKey === '2026-10-11'
    );
    expect(minoxRecordAfterUndo).toBeUndefined();

    // Al recalcular a las 20:05, Minoxidil (22:00) y las insistencias restantes del Dermastamp vuelven a programarse
    const nowAfterUndo = buildDateFromKeyAndHHMM('2026-10-11', '20:05');
    const scheduleAfterUndo = computeSchedule({
      now: nowAfterUndo,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: updatedRecords,
      settings,
      noticeMode: { type: 'alarm' },
    });

    const minoxOverview = scheduleAfterUndo.upcomingSevenDaysOverview.find(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-11'
    );
    expect(minoxOverview?.blocked).toBe(false);

    const minoxPromptsToday = scheduleAfterUndo.activePromptsToSchedule.filter(
      (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-11'
    );
    expect(minoxPromptsToday.length).toBeGreaterThan(0);

    const dermastampInsistenceToday = scheduleAfterUndo.activePromptsToSchedule.filter(
      (p) => p.routineId === 'dermastamp' && p.dateKey === '2026-10-11'
    );
    expect(dermastampInsistenceToday.length).toBeGreaterThan(0);
  });

  it('(12) Deshacer pastilla de la mañana restaura el segundo aviso de la tarde y sus insistencias', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      pillMorningTimeHHMM: '09:00',
      pillAfternoonTimeHHMM: '15:30',
    };
    const routines = createInitialRoutines(settings);
    const pastillaRoutine = routines.find((r) => r.id === 'pastilla')!;

    // A las 09:05 el usuario marca la pastilla como hecha
    const doneAt = buildDateFromKeyAndHHMM('2026-10-12', '09:05');
    const marked = markRoutineDone(pastillaRoutine, undefined, '2026-10-12', doneAt);
    expect(marked.record.status).toBe('completed');

    // Mientras está marcada como hecha, no hay ningún aviso de tarde programado para el 2026-10-12
    const scheduleWhileDone = computeSchedule({
      now: doneAt,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [marked.record],
      settings,
      noticeMode: { type: 'alarm' },
    });
    const afternoonWhileDone = scheduleWhileDone.activePromptsToSchedule.filter(
      (p) => p.routineId === 'pastilla' && p.dateKey === '2026-10-12'
    );
    expect(afternoonWhileDone).toHaveLength(0);

    // A las 10:30 el usuario deshace la pastilla
    const now1030 = buildDateFromKeyAndHHMM('2026-10-12', '10:30');
    const updatedRecords = unmarkRoutineDone(
      'pastilla',
      '2026-10-12',
      [marked.record],
      routines,
      DEFAULT_BLOCKING_RULES,
      settings
    );
    const unmarked = updatedRecords.find(
      (r) => r.routineId === 'pastilla' && r.dateKey === '2026-10-12'
    );
    expect(unmarked?.status).toBe('pending');

    const scheduleAfterUndo = computeSchedule({
      now: now1030,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: updatedRecords,
      settings,
      noticeMode: { type: 'alarm' },
    });

    // El segundo aviso de la tarde (15:30) y sus insistencias vuelven a estar en la cola activa
    const afternoonPrimary = scheduleAfterUndo.activePromptsToSchedule.find(
      (p) =>
        p.routineId === 'pastilla' &&
        p.dateKey === '2026-10-12' &&
        p.kind === 'secondary_primary'
    );
    expect(afternoonPrimary).toBeDefined();
    expect(afternoonPrimary?.scheduledAtISO).toBe(
      buildDateFromKeyAndHHMM('2026-10-12', '15:30').toISOString()
    );

    const afternoonInsistences = scheduleAfterUndo.activePromptsToSchedule.filter(
      (p) =>
        p.routineId === 'pastilla' &&
        p.dateKey === '2026-10-12' &&
        p.kind === 'secondary_insistence'
    );
    expect(afternoonInsistences.length).toBeGreaterThan(0);
  });

  it('(13) Deshacer una tarea completada recalcula la racha y los porcentajes de cumplimiento diario y semanal', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      pillMorningTimeHHMM: '09:00',
      sleepTimeHHMM: '00:00', // Minoxidil 22:00
    };
    const routines = createInitialRoutines(settings);
    const now2230 = buildDateFromKeyAndHHMM('2026-10-12', '22:30'); // Lunes 22:30 (ambas vencidas)

    // Día anterior (domingo 2026-10-11) 100% completado + lunes 2026-10-12 100% completado -> racha = 2 días
    const recordsCompleted: RoutineDayRecord[] = [
      {
        routineId: 'pastilla',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '09:05').toISOString(),
      },
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-11',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '20:05').toISOString(),
        completedChecklistSteps: ['disinfect', 'applied'],
      },
      {
        routineId: 'pastilla',
        dateKey: '2026-10-12',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-12', '09:05').toISOString(),
      },
      {
        routineId: 'minoxidil',
        dateKey: '2026-10-12',
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-12', '22:05').toISOString(),
      },
    ];

    expect(
      computeCurrentStreakDays(
        '2026-10-12',
        routines,
        recordsCompleted,
        DEFAULT_BLOCKING_RULES,
        settings
      )
    ).toBe(2);
    expect(
      computeDueProgressForDay(
        now2230,
        routines,
        recordsCompleted,
        DEFAULT_BLOCKING_RULES,
        settings
      ).percentage
    ).toBe(100);
    expect(
      computeWeeklyCompliancePercentage(
        now2230,
        routines,
        recordsCompleted,
        DEFAULT_BLOCKING_RULES,
        settings
      ).percentage
    ).toBe(100);

    // Deshacemos Minoxidil del lunes 2026-10-12
    const updatedRecords = unmarkRoutineDone(
      'minoxidil',
      '2026-10-12',
      recordsCompleted,
      routines,
      DEFAULT_BLOCKING_RULES,
      settings
    );

    // La racha baja de 2 a 1 (el domingo sigue completo, pero hoy lunes vuelve a estar en progreso)
    expect(
      computeCurrentStreakDays(
        '2026-10-12',
        routines,
        updatedRecords,
        DEFAULT_BLOCKING_RULES,
        settings
      )
    ).toBe(1);

    // El progreso vencido de hoy lunes baja de 100% (2/2) a 50% (1/2)
    const todayProgressAfterUndo = computeDueProgressForDay(
      now2230,
      routines,
      updatedRecords,
      DEFAULT_BLOCKING_RULES,
      settings
    );
    expect(todayProgressAfterUndo.completedDueCount).toBe(1);
    expect(todayProgressAfterUndo.totalDueCount).toBe(2);
    expect(todayProgressAfterUndo.percentage).toBe(50);

    // El cumplimiento semanal baja de 100% (4/4) a 75% (3/4)
    const weeklyAfterUndo = computeWeeklyCompliancePercentage(
      now2230,
      routines,
      updatedRecords,
      DEFAULT_BLOCKING_RULES,
      settings
    );
    expect(weeklyAfterUndo.completedCount).toBe(3);
    expect(weeklyAfterUndo.evaluableCount).toBe(4);
    expect(weeklyAfterUndo.percentage).toBe(75);
  });

  it('(14) Eliminar rutina: devuelve IDs de alarmas a cancelar, borra reglas de bloqueo que la referencian y conserva su historial pasado con el nombre guardado', () => {
    const settings = { ...DEFAULT_GLOBAL_SETTINGS };
    const routines = createInitialRoutines(settings);
    const now = buildDateFromKeyAndHHMM('2026-10-11', '12:00');

    const records: RoutineDayRecord[] = [
      {
        routineId: 'dermastamp',
        dateKey: '2026-10-04', // Domingo pasado completado
        status: 'completed',
        completedAtISO: buildDateFromKeyAndHHMM('2026-10-04', '20:10').toISOString(),
      },
    ];

    const preSchedule = computeSchedule({
      now,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records,
      settings,
      noticeMode: { type: 'alarm' },
    });

    const cleanup = deleteRoutineAndCleanup({
      routineId: 'dermastamp',
      todayKey: '2026-10-11',
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records,
      activePrompts: preSchedule.activePromptsToSchedule,
    });

    // 1. La rutina ya no está en la lista activa
    expect(cleanup.routines.some((r) => r.id === 'dermastamp')).toBe(false);
    // 2. Se borraron las reglas de bloqueo que referenciaban a dermastamp
    expect(
      cleanup.blockingRules.some(
        (b) =>
          b.sourceRoutineId === 'dermastamp' || b.targetRoutineId === 'dermastamp'
      )
    ).toBe(false);
    // 3. Se devolvieron los IDs numéricos de sus alarmas programadas para cancelarlas
    expect(cleanup.cancelledNumericIds.length).toBeGreaterThan(0);
    // 4. El historial pasado se conserva con routineName = "Dermastamp"
    const preservedRecord = cleanup.records.find(
      (r) => r.routineId === 'dermastamp' && r.dateKey === '2026-10-04'
    );
    expect(preservedRecord).toBeDefined();
    expect(preservedRecord?.routineName).toBe('Dermastamp');

    // Al inspeccionar el día pasado 2026-10-04 en Historial, aparece con su nombre guardado "Dermastamp"
    const pastDaySummary = evaluateDaySummary(
      '2026-10-04',
      '2026-10-11',
      cleanup.routines,
      cleanup.records,
      cleanup.blockingRules,
      settings
    );
    const deletedRoutineInHistory = pastDaySummary.routineStatuses.find(
      (item) => item.routineId === 'dermastamp'
    );
    expect(deletedRoutineInHistory).toBeDefined();
    expect(deletedRoutineInHistory?.routineName).toBe('Dermastamp');
    expect(deletedRoutineInHistory?.status).toBe('completed');
  });

  it('(15) Esquema guardado con versión y migración segura + soporte de 6 rutinas con nombres largos', () => {
    const settings = { ...DEFAULT_GLOBAL_SETTINGS };
    const baseRoutines = createInitialRoutines(settings);
    const sixLongRoutines = [
      ...baseRoutines,
      {
        id: 'locion-capilar-nocturna-extra-fuerte',
        name: 'Loción Capilar Nocturna Extra Fuerte Con Biotina y Cafeína',
        enabled: true,
        scheduleType: 'fixed_daily' as const,
        fixedTimeHHMM: '21:15',
        insistIntervalMinutes: 10,
        insistDurationMinutes: 60,
        allowDiscreetMode: true,
      },
      {
        id: 'suplemento-complejo-vitaminico-b12-zinc',
        name: 'Suplemento Complejo Vitamínico B12 + Zinc Quelado Mañana',
        enabled: true,
        scheduleType: 'fixed_daily' as const,
        fixedTimeHHMM: '10:30',
        insistIntervalMinutes: 15,
        insistDurationMinutes: 60,
        allowDiscreetMode: true,
      },
      {
        id: 'masaje-cuero-cabelludo-estimulacion-folicular',
        name: 'Masaje de Cuero Cabelludo para Estimulación Folicular Profunda',
        enabled: true,
        scheduleType: 'weekly' as const,
        weekday: 3,
        fixedTimeHHMM: '19:45',
        insistIntervalMinutes: 15,
        insistDurationMinutes: 60,
        allowDiscreetMode: false,
      },
    ];

    expect(sixLongRoutines).toHaveLength(6);

    // Simular datos guardados de una versión anterior (sin schemaVersion y con campos corruptos/antiguos)
    const migrated = migrateAndSanitizeState({
      schemaVersion: null,
      settings: { sleepTimeHHMM: '01:00', pillMorningTimeHHMM: 'bad-time' },
      routines: sixLongRoutines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [
        {
          routineId: 'pastilla',
          dateKey: '2026-10-10',
          status: 'completed',
          // Sin routineName en versión v1: la migración lo rellena automáticamente
        },
        {
          // Registro corrupto que debe ser descartado sin romper el arranque
          routineId: '',
          dateKey: 'invalid-date',
          status: 'unknown_status',
        },
      ],
      noticeMode: { type: 'discreet', untilISO: 'invalid-iso' },
    });

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.settings.sleepTimeHHMM).toBe('01:00');
    // El campo inválido 'bad-time' usa el fallback seguro
    expect(migrated.settings.pillMorningTimeHHMM).toBe(
      DEFAULT_GLOBAL_SETTINGS.pillMorningTimeHHMM
    );
    expect(migrated.routines).toHaveLength(6);
    expect(migrated.records).toHaveLength(1);
    expect(migrated.records[0].routineName).toBe('Pastilla');
    // Un modo discreto sin untilISO válido se sanea a 'alarm' para no bloquear el arranque
    expect(migrated.noticeMode.type).toBe('alarm');
  });

  it('(16) Posponer por tarea ("postponeRoutineTask"): sirve para cualquier rutina, cancela insistencias previas y reprograma con tope a la hora de dormir', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      sleepTimeHHMM: '23:30', // Tope hora de dormir = 23:30; Minoxidil base = 21:30
    };
    const routines = createInitialRoutines(settings);
    const minoxidil = routines.find((r) => r.id === 'minoxidil')!;
    const dateKey = '2026-10-12';

    // A las 21:45 (cuando ya habría sonado el aviso principal de 21:30 y la 1ª insistencia de 21:40),
    // el usuario pospone +1 h -> nuevo aviso principal a las 22:45.
    const now2145 = buildDateFromKeyAndHHMM(dateKey, '21:45');
    const p1 = postponeRoutineTask({
      routine: minoxidil,
      existingRecord: undefined,
      dateKey,
      now: now2145,
      settings,
      mode: { type: 'add_hours', hours: 1 },
    });
    expect(p1.nextTimeHHMM).toBe('22:45');
    expect(p1.reachedCap).toBe(false);
    expect(p1.record.postponeCount).toBe(1);

    // Verificamos que las insistencias previas (21:50, 22:00...) ya NO existen y el nuevo aviso principal es a las 22:45
    const schedAfterP1 = computeSchedule({
      now: now2145,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [p1.record],
      settings,
      noticeMode: { type: 'alarm' },
    });
    const minoxPromptsToday = schedAfterP1.activePromptsToSchedule.filter(
      (p) => p.routineId === 'minoxidil' && p.dateKey === dateKey
    );
    expect(minoxPromptsToday.length).toBeGreaterThan(0);
    expect(minoxPromptsToday[0].kind).toBe('primary');
    expect(minoxPromptsToday[0].scheduledAtISO).toBe(
      buildDateFromKeyAndHHMM(dateKey, '22:45').toISOString()
    );
    expect(minoxPromptsToday[0].actions).toEqual([
      'DONE',
      'POSTPONE_1H',
      'PAUSE_2H',
    ]);

    // 2ª posposición (+1 h desde las 22:45 -> pediría 23:45, pero se trunca al tope de dormir 23:30)
    const p2 = postponeRoutineTask({
      routine: minoxidil,
      existingRecord: p1.record,
      dateKey,
      now: now2145,
      settings,
      mode: { type: 'add_hours', hours: 1 },
    });
    expect(p2.nextTimeHHMM).toBe('23:30');
    expect(p2.reachedCap).toBe(true);
    expect(p2.record.postponeCount).toBe(2);

    // 3ª posposición (+2 h estando ya en el tope 23:30) -> se mantiene clavado en 23:30
    const p3 = postponeRoutineTask({
      routine: minoxidil,
      existingRecord: p2.record,
      dateKey,
      now: now2145,
      settings,
      mode: { type: 'add_hours', hours: 2 },
    });
    expect(p3.nextTimeHHMM).toBe('23:30');
    expect(p3.reachedCap).toBe(true);
    expect(p3.record.postponeCount).toBe(3);

    // También funciona con "until_time" en una rutina personalizada o pastilla y se puede restablecer
    const pastilla = routines.find((r) => r.id === 'pastilla')!;
    const pCustom = postponeRoutineTask({
      routine: pastilla,
      existingRecord: undefined,
      dateKey,
      now: buildDateFromKeyAndHHMM(dateKey, '09:10'),
      settings,
      mode: { type: 'until_time', targetHHMM: '11:45' },
    });
    expect(pCustom.nextTimeHHMM).toBe('11:45');
    expect(pCustom.reachedCap).toBe(false);

    const resetRec = resetRoutinePostpone(pCustom.record);
    expect(resetRec?.postponedPrimaryTimeHHMM).toBeUndefined();
    expect(resetRec?.postponedPrimaryAtISO).toBeUndefined();
  });

  it('(17) Pausa activa cancela todos los avisos en la ventana y emite UN SOLO aviso resumen al terminar cuando hay varias tareas pendientes + límite de ráfaga maxInsistenceCount', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      pillMorningTimeHHMM: '09:00',
      dermastampWeekday: 0, // Domingo
      dermastampTimeHHMM: '10:00',
      sleepTimeHHMM: '00:00', // Minoxidil 22:00
      maxInsistenceCount: 4, // Límite configurable (probamos con 4)
    };
    const routines = createInitialRoutines(settings);
    const sundayKey = '2026-10-11';
    const now0850 = buildDateFromKeyAndHHMM(sundayKey, '08:50');

    // Pausamos desde las 08:50 hasta las 12:00 del domingo:
    // Tanto Pastilla (09:00) como Dermastamp (10:00) caen dentro de la pausa y siguen pendientes.
    const pauseUntil = buildDateFromKeyAndHHMM(sundayKey, '12:00');
    const pausedMode: ActiveNoticeMode = {
      type: 'paused',
      startedAtISO: now0850.toISOString(),
      untilISO: pauseUntil.toISOString(),
      targetHHMM: '12:00',
    };

    const schedPaused = computeSchedule({
      now: now0850,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [],
      settings,
      noticeMode: pausedMode,
    });

    // 1. Ningún aviso suena entre las 08:50 y las 12:00 (todos están cancelados en la ventana de pausa)
    const promptsDuringPause = schedPaused.activePromptsToSchedule.filter(
      (p) =>
        new Date(p.scheduledAtISO).getTime() >= now0850.getTime() &&
        new Date(p.scheduledAtISO).getTime() < pauseUntil.getTime()
    );
    expect(promptsDuringPause).toHaveLength(0);

    // 2. Al terminar la pausa (12:00), se programa UN SOLO aviso resumen ('pause_recovery') para las 2 tareas pendientes (Pastilla y Dermastamp)
    const recoveryPrompts = schedPaused.activePromptsToSchedule.filter(
      (p) => p.kind === 'pause_recovery'
    );
    expect(recoveryPrompts).toHaveLength(1);
    expect(recoveryPrompts[0].scheduledAtISO).toBe(pauseUntil.toISOString());
    expect(recoveryPrompts[0].routineName).toContain('Pastilla');
    expect(recoveryPrompts[0].routineName).toContain('Dermastamp');

    // 3. Verificamos el límite de ráfaga de insistencias (maxInsistenceCount = 4) en Minoxidil (22:00, fuera de la pausa):
    // 1 aviso principal + 4 insistencias como máximo = 5 avisos en total para Minoxidil ese día
    const minoxPrompts = schedPaused.activePromptsToSchedule.filter(
      (p) => p.routineId === 'minoxidil' && p.dateKey === sundayKey
    );
    const minoxInsistences = minoxPrompts.filter(
      (p) => p.kind === 'insistence'
    );
    expect(minoxInsistences).toHaveLength(4);
  });

  it('(18) Posponer y pausar combinados con el bloqueo de 24h del Dermastamp', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      sleepTimeHHMM: '00:00', // Minoxidil base = 22:00
    };
    const routines = createInitialRoutines(settings);
    const minoxidil = routines.find((r) => r.id === 'minoxidil')!;

    // Escenario A: Dermastamp se completó el sábado 2026-10-10 a las 22:30 -> bloquea 24h hasta el domingo 2026-10-11 a las 22:30.
    // El domingo 2026-10-11 a las 22:00 Minoxidil estaría bloqueado (caería a +23.5h).
    // Si el usuario pospone Minoxidil del domingo +1 h (a las 23:00 del domingo, +24.5h reales desde el Dermastamp),
    // la nueva hora pospuesta (23:00) cae FUERA de las 24h de bloqueo y SÍ se programa.
    const satDermastampAt = buildDateFromKeyAndHHMM('2026-10-10', '22:30');
    const dermastampRecord: RoutineDayRecord = {
      routineId: 'dermastamp',
      dateKey: '2026-10-10',
      status: 'completed',
      completedAtISO: satDermastampAt.toISOString(),
      completedChecklistSteps: ['disinfect', 'applied'],
    };

    const sundayNow = buildDateFromKeyAndHHMM('2026-10-11', '21:00');
    const postponedMinox = postponeRoutineTask({
      routine: minoxidil,
      existingRecord: undefined,
      dateKey: '2026-10-11',
      now: sundayNow,
      settings,
      mode: { type: 'add_hours', hours: 1 }, // 22:00 + 1h = 23:00
    });
    expect(postponedMinox.nextTimeHHMM).toBe('23:00');

    const schedWithPostponedMinox = computeSchedule({
      now: sundayNow,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [dermastampRecord, postponedMinox.record],
      settings,
      noticeMode: { type: 'alarm' },
    });

    const sundayMinoxOverview =
      schedWithPostponedMinox.upcomingSevenDaysOverview.find(
        (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-11'
      );
    expect(sundayMinoxOverview?.blocked).toBe(false);

    // Escenario B: Si Dermastamp se completa el domingo a las 21:00 (bloquea hasta lunes 21:00) y además hay una pausa activa hasta las 23:00 del domingo,
    // el aviso resumen de fin de pausa a las 23:00 NO debe incluir Minoxidil porque Minoxidil está bloqueado por Dermastamp.
    const sunDermastampRecord: RoutineDayRecord = {
      routineId: 'dermastamp',
      dateKey: '2026-10-11',
      status: 'completed',
      completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '21:00').toISOString(),
      completedChecklistSteps: ['disinfect', 'applied'],
    };
    const sunPastillaDone: RoutineDayRecord = {
      routineId: 'pastilla',
      dateKey: '2026-10-11',
      status: 'completed',
      completedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '09:05').toISOString(),
    };
    const pauseOnSundayNight = computeSchedule({
      now: buildDateFromKeyAndHHMM('2026-10-11', '21:05'),
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [sunDermastampRecord, sunPastillaDone],
      settings,
      noticeMode: {
        type: 'paused',
        startedAtISO: buildDateFromKeyAndHHMM('2026-10-11', '21:05').toISOString(),
        untilISO: buildDateFromKeyAndHHMM('2026-10-11', '23:00').toISOString(),
        targetHHMM: '23:00',
      },
    });
    expect(
      pauseOnSundayNight.activePromptsToSchedule.filter(
        (p) => p.kind === 'pause_recovery'
      )
    ).toHaveLength(0);
  });

  it('(19) Cambio de hora DST (domingo 25 de octubre de 2026, zona Europe/Madrid, día de 25 h): alarmas por hora local de reloj y bloqueo de 24 h por horas reales transcurridas', () => {
    const settings: GlobalSettings = {
      ...DEFAULT_GLOBAL_SETTINGS,
      pillMorningTimeHHMM: '09:00',
      sleepTimeHHMM: '00:00', // Minoxidil a las 22:00 hora local de pared
    };
    const routines = createInitialRoutines(settings);

    // Sábado 24 de octubre de 2026 a las 22:00 (CEST, UTC+2 -> 20:00Z) el usuario completa Dermastamp.
    // El domingo 25 de octubre de 2026 tiene 25 horas reales en Europe/Madrid (a las 03:00 CEST el reloj atrasa a las 02:00 CET, UTC+1).
    const satOct24_2200 = buildDateFromKeyAndHHMM('2026-10-24', '22:00');
    const sunOct25_0900 = buildDateFromKeyAndHHMM('2026-10-25', '09:00');
    const sunOct25_2200 = buildDateFromKeyAndHHMM('2026-10-25', '22:00');

    // 1. Las alarmas del sábado 24 y domingo 25 de octubre se programan respetando la hora local del reloj de pared (09:00 y 22:00 locales)
    expect(satOct24_2200.getHours()).toBe(22);
    expect(sunOct25_0900.getHours()).toBe(9);
    expect(sunOct25_0900.getMinutes()).toBe(0);
    expect(sunOct25_2200.getHours()).toBe(22);
    expect(sunOct25_2200.getMinutes()).toBe(0);

    // 2. En Europe/Madrid, entre el sábado 24/10 22:00 (CEST, UTC+2) y el domingo 25/10 22:00 (CET, UTC+1)
    // transcurren 25 horas reales (o en cualquier zona se mide por epoch ms reales: 24 * 3_600_000 ms).
    // Si simulamos el instante exacto de completado 25 horas reales antes de sunOct25_2200
    // (como ocurre en Europe/Madrid al marcar a las 22:00 CEST del sábado 24), han pasado 25 h reales (> 24 h)
    // y el Minoxidil de las 22:00 CET del domingo 25 NO queda bloqueado; mientras que a las 21:00 CET (+24 h exactas) SÍ sigue bloqueado.
    const real25HoursBeforeSun2200 = new Date(
      sunOct25_2200.getTime() - 25 * 3600_000
    );
    const real23Hours30MinBeforeSun2200 = new Date(
      sunOct25_2200.getTime() - 23.5 * 3600_000
    );

    const schedAfter25RealHours = computeSchedule({
      now: sunOct25_0900,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [
        {
          routineId: 'dermastamp',
          dateKey: '2026-10-24',
          status: 'completed',
          completedAtISO: real25HoursBeforeSun2200.toISOString(),
          completedChecklistSteps: ['disinfect', 'applied'],
        },
      ],
      settings,
      noticeMode: { type: 'alarm' },
    });

    const minoxSunOct25After25h =
      schedAfter25RealHours.upcomingSevenDaysOverview.find(
        (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-25'
      );
    expect(minoxSunOct25After25h?.blocked).toBe(false);

    const schedAfter23h30mRealHours = computeSchedule({
      now: sunOct25_0900,
      routines,
      blockingRules: DEFAULT_BLOCKING_RULES,
      records: [
        {
          routineId: 'dermastamp',
          dateKey: '2026-10-24',
          status: 'completed',
          completedAtISO: real23Hours30MinBeforeSun2200.toISOString(),
          completedChecklistSteps: ['disinfect', 'applied'],
        },
      ],
      settings,
      noticeMode: { type: 'alarm' },
    });

    const minoxSunOct25After23h30m =
      schedAfter23h30mRealHours.upcomingSevenDaysOverview.find(
        (p) => p.routineId === 'minoxidil' && p.dateKey === '2026-10-25'
      );
    expect(minoxSunOct25After23h30m?.blocked).toBe(true);
  });

  it('(20) Firma de la app (Sideloadly 7 días): calcula días restantes y fecha del aviso el día 6', () => {
    const reinstallDate = buildDateFromKeyAndHHMM('2026-10-10', '10:00');
    const nowDay2 = buildDateFromKeyAndHHMM('2026-10-12', '11:00'); // Han pasado 2 días y 1h -> quedan 5 días

    const status = computeSideloadSignatureStatus(
      nowDay2,
      reinstallDate.toISOString()
    );
    expect(status.configured).toBe(true);
    expect(status.remainingDays).toBe(5);
    expect(status.expired).toBe(false);
    expect(status.warningAtISO).toBe(
      new Date(reinstallDate.getTime() + 6 * 24 * 3600_000).toISOString()
    );
  });
});

// @end: Unit-Tests-Scheduler
