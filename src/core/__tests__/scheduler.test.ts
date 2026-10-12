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
  computeSchedule,
  computeWeeklyCompliancePercentage,
  postponeRoutineNotAtHome,
  resolveRoutinePrimaryHHMM,
  toggleChecklistStep,
} from '../scheduler';
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

  it('(5) "No estoy en casa" repetido desde las 15:30 pospone de 1h en 1h hasta el límite máximo de las 22:00', () => {
    const routines = createInitialRoutines(DEFAULT_GLOBAL_SETTINGS);
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
      '22:00', // 7ª pulsación (21:30 + 1h = 22:30 -> truncado al tope 22:00)
      '22:00', // 8ª pulsación (se mantiene clavado en el tope de las 22:00)
    ];

    let callClock = buildDateFromKeyAndHHMM(dateKey, '15:35');

    for (let i = 0; i < expectedTimes.length; i++) {
      const res = postponeRoutineNotAtHome(pillRoutine, record, dateKey, callClock);
      record = res.record;
      expect(res.nextTimeHHMM).toBe(expectedTimes[i]);
      if (i < 6) {
        expect(res.reachedCap).toBe(false);
      } else {
        expect(res.reachedCap).toBe(true);
      }
      // Simulamos que el usuario vuelve a pulsar cuando salta el nuevo aviso pospuesto
      callClock = buildDateFromKeyAndHHMM(dateKey, res.nextTimeHHMM);
    }

    expect(record?.notAtHomePostponeCount).toBe(8);
    expect(record?.postponedAfternoonTimeHHMM).toBe('22:00');
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
});

// @end: Unit-Tests-Scheduler
