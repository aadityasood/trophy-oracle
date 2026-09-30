import { describe, expect, it } from 'vitest';
import {
  AchievementRecordSchema,
  AchievementSetSchema,
  type AchievementRecord,
  type AchievementSet,
} from './achievement-schema';
import {
  AchievementProgressV3Schema,
  RunProgressSchema,
  type AchievementProgressV3,
  type CounterProgress,
  type OrphanedAchievementProgressV3,
  type RunProgress,
} from './hunt-memory-schema';
import { createDefaultRunProgress } from './hunt-memory-lifecycle';
import {
  getRunOracleFocus,
  hasRunPartialProgress,
} from './hunt-memory-view';

const TS = '2026-09-30T12:00:00.000Z';

// Helpers parse structural schemas; invalid prerequisites, ID/shape mismatches,
// and prototype-bearing maps below are deliberate defensive selector fixtures.
function makeAchievement(
  id: string,
  overrides: Partial<AchievementRecord> = {},
): AchievementRecord {
  return AchievementRecordSchema.parse({
    id,
    name: `Name ${id}`,
    description: `Description ${id}`,
    evidence: `Evidence ${id}`,
    reward: { type: 'achievement' },
    tracking: { mode: 'binary' },
    labels: ['story'],
    expectedStage: 'story',
    confidence: 1,
    prerequisites: [],
    ...overrides,
  });
}

function makeSet(
  achievements: AchievementRecord[],
  id = 'test-set',
): AchievementSet {
  return AchievementSetSchema.parse({
    id,
    platform: 'steam',
    version: '1.0.0',
    achievements,
  });
}

function makeRun(
  set: AchievementSet,
  runId = 'default-run',
  activeStage?: 'story' | 'missables' | 'cleanup',
): RunProgress {
  const run = createDefaultRunProgress(set, runId, 'Main Run', TS);
  if (activeStage) {
    run.activeStage = activeStage;
  }
  return RunProgressSchema.parse(run);
}

function makeProgress(
  achievementId: string,
  overrides: Partial<AchievementProgressV3> = {},
): AchievementProgressV3 {
  return AchievementProgressV3Schema.parse({
    achievementId,
    completed: false,
    manualOverride: false,
    lastUpdated: TS,
    provenance: 'manual',
    ...overrides,
  });
}

function makeCounter(
  achievementId: string,
  counter: CounterProgress,
  completed = false,
): AchievementProgressV3 {
  return makeProgress(achievementId, { completed, counter });
}

function makeOrphan(
  achievementId: string,
  trackingModeAtRemoval: 'binary' | 'counter' | 'checklist',
): OrphanedAchievementProgressV3 {
  return {
    achievementId,
    completed: true,
    manualOverride: false,
    trackingModeAtRemoval,
    lastUpdated: TS,
    provenance: 'manual',
  };
}

describe('hasRunPartialProgress', () => {
  it('evaluates zero and positive observations for all certainty modes across bounded and open counters', () => {
    const bnd = makeAchievement('bnd', {
      tracking: { mode: 'counter', unit: 'kills', target: 10 },
      expectedStage: 'cleanup',
    });
    const opn = makeAchievement('opn', {
      tracking: { mode: 'counter', unit: 'orbs' },
      expectedStage: 'cleanup',
    });

    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'exact', value: 0 }))).toBe(false);
    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'exact', value: 1 }))).toBe(true);
    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'exact', value: 10 }, true))).toBe(false);

    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'at_least', minimum: 0 }))).toBe(false);
    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'at_least', minimum: 3 }))).toBe(true);

    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'estimated', estimate: 0 }))).toBe(false);
    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'estimated', estimate: 4 }))).toBe(true);
    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'estimated', estimate: 15 }))).toBe(true);

    expect(hasRunPartialProgress(
      bnd,
      makeCounter('bnd', { certainty: 'unknown', observedSinceStart: 0, trackingStartedAt: TS }),
    )).toBe(false);
    expect(hasRunPartialProgress(
      bnd,
      makeCounter('bnd', { certainty: 'unknown', observedSinceStart: 2, trackingStartedAt: TS }),
    )).toBe(true);
    expect(hasRunPartialProgress(
      bnd,
      makeCounter('bnd', { certainty: 'unknown', observedSinceStart: 12, trackingStartedAt: TS }),
    )).toBe(true);

    expect(hasRunPartialProgress(bnd, makeCounter('bnd', { certainty: 'estimated', estimate: 10 }))).toBe(true);
    expect(hasRunPartialProgress(
      bnd,
      makeCounter('bnd', { certainty: 'unknown', observedSinceStart: 10, trackingStartedAt: TS }),
    )).toBe(true);

    const completedCounters: CounterProgress[] = [
      { certainty: 'at_least', minimum: 10 },
      { certainty: 'estimated', estimate: 10 },
      { certainty: 'unknown', observedSinceStart: 10, trackingStartedAt: TS },
    ];
    for (const counter of completedCounters) {
      const completed = makeProgress('bnd', {
        completed: true,
        manualOverride: true,
        counter,
      });
      expect(hasRunPartialProgress(bnd, completed)).toBe(false);
    }

    expect(hasRunPartialProgress(opn, makeCounter('opn', { certainty: 'exact', value: 0 }))).toBe(false);
    expect(hasRunPartialProgress(opn, makeCounter('opn', { certainty: 'exact', value: 5 }))).toBe(true);

    expect(hasRunPartialProgress(opn, makeCounter('opn', { certainty: 'at_least', minimum: 0 }))).toBe(false);
    expect(hasRunPartialProgress(opn, makeCounter('opn', { certainty: 'at_least', minimum: 2 }))).toBe(true);

    expect(hasRunPartialProgress(opn, makeCounter('opn', { certainty: 'estimated', estimate: 0 }))).toBe(false);
    expect(hasRunPartialProgress(opn, makeCounter('opn', { certainty: 'estimated', estimate: 6 }))).toBe(true);

    expect(hasRunPartialProgress(
      opn,
      makeCounter('opn', { certainty: 'unknown', observedSinceStart: 0, trackingStartedAt: TS }),
    )).toBe(false);
    expect(hasRunPartialProgress(
      opn,
      makeCounter('opn', { certainty: 'unknown', observedSinceStart: 4, trackingStartedAt: TS }),
    )).toBe(true);
  });

  it('returns false for binary achievements whether incomplete or completed', () => {
    const bin = makeAchievement('bin-01');
    expect(hasRunPartialProgress(bin, makeProgress('bin-01'))).toBe(false);
    expect(hasRunPartialProgress(bin, makeProgress('bin-01', { completed: true }))).toBe(false);
  });

  it('evaluates checklist progress by counting only defined items with own exact-true values', () => {
    const chk = makeAchievement('chk-01', {
      tracking: {
        mode: 'checklist',
        items: [
          { id: 'item-1', name: 'Item 1' },
          { id: 'item-2', name: 'Item 2' },
        ],
      },
      expectedStage: 'cleanup',
    });

    const allFalse = makeProgress('chk-01', { checklistCompletion: { 'item-1': false, 'item-2': false } });
    expect(hasRunPartialProgress(chk, allFalse)).toBe(false);

    const oneTrue = makeProgress('chk-01', { checklistCompletion: { 'item-1': true, 'item-2': false } });
    expect(hasRunPartialProgress(chk, oneTrue)).toBe(true);

    const completedTrue = makeProgress('chk-01', {
      completed: true,
      manualOverride: true,
      checklistCompletion: { 'item-1': true, 'item-2': true },
    });
    expect(hasRunPartialProgress(chk, completedTrue)).toBe(false);

    // Defensive: unrelated stale key fails tracker-shape check
    const staleKeyDefensive = {
      ...allFalse,
      checklistCompletion: { 'item-1': false, 'item-2': false, unrelated: true },
    };
    expect(hasRunPartialProgress(chk, staleKeyDefensive as AchievementProgressV3)).toBe(false);

    // Defensive: inherited key on prototype fails own-property checks
    const inheritedPrototype = Object.create({ 'item-1': true });
    inheritedPrototype['item-2'] = false;
    const inheritedDefensive = {
      ...allFalse,
      checklistCompletion: inheritedPrototype,
    };
    expect(hasRunPartialProgress(chk, inheritedDefensive as AchievementProgressV3)).toBe(false);
  });

  it('fails closed on missing progress, achievement ID mismatch, and tracker shape mismatch', () => {
    const cnt = makeAchievement('ach-01', {
      tracking: { mode: 'counter', unit: 'items', target: 10 },
    });
    expect(hasRunPartialProgress(cnt, makeCounter('ach-01', { certainty: 'exact', value: 5 }))).toBe(true);
    expect(hasRunPartialProgress(cnt, undefined)).toBe(false);

    const idMismatch = makeCounter('wrong-id', { certainty: 'exact', value: 5 });
    expect(hasRunPartialProgress(cnt, idMismatch)).toBe(false);

    const shapeMismatch = makeProgress('ach-01', {
      checklistCompletion: { 'item-1': true },
    });
    expect(hasRunPartialProgress(cnt, shapeMismatch)).toBe(false);
  });
});

describe('getRunOracleFocus', () => {
  it('returns empty array when set has no achievements or all achievements are complete', () => {
    const emptySet = makeSet([]);
    expect(getRunOracleFocus(emptySet, makeRun(emptySet))).toEqual([]);

    const set = makeSet([makeAchievement('a1'), makeAchievement('a2')]);
    const run = makeRun(set);
    run.progress.a1.completed = true;
    run.progress.a2.completed = true;
    expect(getRunOracleFocus(set, run)).toEqual([]);
  });

  it('fails closed on missing, mismatched, or tracker-incompatible candidate progress records', () => {
    const ach = makeAchievement('c1');
    const set = makeSet([ach]);
    const run = makeRun(set);

    delete (run.progress as Record<string, unknown>)['c1'];
    expect(getRunOracleFocus(set, run)).toEqual([]);

    run.progress['c1'] = makeProgress('wrong-id');
    expect(getRunOracleFocus(set, run)).toEqual([]);

    run.progress['c1'] = makeCounter('c1', { certainty: 'exact', value: 5 });
    expect(getRunOracleFocus(set, run)).toEqual([]);
  });

  it('enforces prerequisite isolation and fails closed on missing, foreign, or orphan-only prerequisites', () => {
    const pre = makeAchievement('pre-01');
    const dep = makeAchievement('dep-01', { prerequisites: ['pre-01'] });
    const missingDep = makeAchievement('dep-missing', { prerequisites: ['missing-id'] });
    const foreignDep = makeAchievement('dep-foreign', { prerequisites: ['foreign-id'] });

    const foreignSet = makeSet([makeAchievement('foreign-id')], 'foreign-set');
    expect(AchievementSetSchema.safeParse(foreignSet).success).toBe(true);

    const set = makeSet([pre, dep, missingDep, foreignDep]);
    const run = makeRun(set);

    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['pre-01']);

    run.progress['pre-01'].completed = true;
    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['dep-01']);

    // Prerequisite definition remains in set, but active progress is removed and completed record exists only in orphans
    const orphanSet = makeSet([pre, dep]);
    const orphanRun = makeRun(orphanSet);
    delete (orphanRun.progress as Record<string, unknown>)['pre-01'];
    orphanRun.orphanedProgress = { 'pre-01': [makeOrphan('pre-01', 'binary')] };
    expect(RunProgressSchema.safeParse(orphanRun).success).toBe(true);
    expect(getRunOracleFocus(orphanSet, orphanRun)).toEqual([]);

    const incompSet = makeSet([pre, dep]);
    const incompRun = makeRun(incompSet);
    incompRun.progress['pre-01'] = makeProgress('pre-01', {
      completed: true,
      counter: { certainty: 'exact', value: 10 },
    });
    expect(getRunOracleFocus(incompSet, incompRun)).toEqual([]);

    // Defensive: the own prerequisite key has a different embedded ID; run admission rejects it.
    incompRun.progress['pre-01'] = makeProgress('wrong-id', { completed: true });
    expect(Object.hasOwn(incompRun.progress, 'pre-01')).toBe(true);
    expect(RunProgressSchema.safeParse(incompRun).success).toBe(false);
    expect(getRunOracleFocus(incompSet, incompRun)).toEqual([]);
  });

  it('supports valid own prototype-named IDs and rejects inherited candidate and prerequisite lookups', () => {
    const protoPre = makeAchievement('constructor');
    const protoAch = makeAchievement('toString', { prerequisites: ['constructor'] });
    const set = makeSet([protoPre, protoAch]);
    const run = makeRun(set);

    expect(Object.hasOwn(run.progress, 'constructor')).toBe(true);
    expect(Object.hasOwn(run.progress, 'toString')).toBe(true);
    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['constructor']);

    (run.progress as Record<string, AchievementProgressV3>)['constructor'].completed = true;
    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['toString']);

    // Direct prototype-bearing progress fixture where candidate progress is inherited rather than own
    const inheritedCandidateRun = makeRun(set);
    inheritedCandidateRun.progress = Object.create({
      constructor: makeProgress('constructor'),
      toString: makeProgress('toString'),
    });
    expect(Object.hasOwn(inheritedCandidateRun.progress, 'constructor')).toBe(false);
    expect(getRunOracleFocus(set, inheritedCandidateRun)).toEqual([]);

    // Direct prototype-bearing progress fixture where completed prerequisite progress is inherited
    const depOnlySet = makeSet([protoPre, protoAch]);
    const inheritedPrereqRun = makeRun(depOnlySet);
    const protoWithCompletedPrereq = {
      constructor: makeProgress('constructor', { completed: true }),
    };
    const progressWithInheritedPrereq = Object.create(protoWithCompletedPrereq);
    progressWithInheritedPrereq.toString = makeProgress('toString');
    inheritedPrereqRun.progress = progressWithInheritedPrereq;
    expect(Object.hasOwn(inheritedPrereqRun.progress, 'toString')).toBe(true);
    expect(Object.hasOwn(inheritedPrereqRun.progress, 'constructor')).toBe(false);
    expect(getRunOracleFocus(depOnlySet, inheritedPrereqRun)).toEqual([]);
  });

  it('proves urgency dominates active stage match', () => {
    const urgClean = makeAchievement('urg-clean', { labels: ['missable'], expectedStage: 'cleanup' });
    const nonurgStory = makeAchievement('nonurg-story', { labels: ['story'], expectedStage: 'story' });
    const set = makeSet([nonurgStory, urgClean]);
    const run = makeRun(set, 'default-run', 'story');
    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['urg-clean', 'nonurg-story']);
  });

  it('proves active stage match dominates partial progress, canonical order, and source order', () => {
    const storyPart = makeAchievement('story-part', {
      tracking: { mode: 'counter', unit: 'items', target: 10 },
      expectedStage: 'story',
    });
    const cleanZero = makeAchievement('clean-zero', {
      tracking: { mode: 'counter', unit: 'items', target: 10 },
      expectedStage: 'cleanup',
    });
    const set = makeSet([storyPart, cleanZero]);
    const run = makeRun(set, 'default-run', 'cleanup');
    run.progress['story-part'].counter = { certainty: 'exact', value: 3 };
    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['clean-zero', 'story-part']);
  });

  it('proves partial progress dominates canonical stage order and source order', () => {
    const storyZero = makeAchievement('story-zero', {
      tracking: { mode: 'counter', unit: 'items', target: 10 },
      expectedStage: 'story',
    });
    const cleanPart = makeAchievement('clean-part', {
      tracking: { mode: 'counter', unit: 'items', target: 10 },
      expectedStage: 'cleanup',
    });
    const set = makeSet([storyZero, cleanPart]);
    const run = makeRun(set, 'default-run', 'missables');
    run.progress['clean-part'].counter = { certainty: 'exact', value: 3 };
    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['clean-part', 'story-zero']);
  });

  it('proves canonical stage order dominates source order when earlier keys tie', () => {
    const missEarly = makeAchievement('miss-early', { expectedStage: 'missables' });
    const storyLate = makeAchievement('story-late', { expectedStage: 'story' });
    const setStoryVsMiss = makeSet([missEarly, storyLate]);
    const runCleanup = makeRun(setStoryVsMiss, 'default-run', 'cleanup');
    expect(getRunOracleFocus(setStoryVsMiss, runCleanup).map((a) => a.id)).toEqual([
      'story-late',
      'miss-early',
    ]);

    const cleanEarly = makeAchievement('clean-early', { expectedStage: 'cleanup' });
    const missLate = makeAchievement('miss-late', { expectedStage: 'missables' });
    const setMissVsClean = makeSet([cleanEarly, missLate]);
    const runStory = makeRun(setMissVsClean, 'default-run', 'story');
    expect(getRunOracleFocus(setMissVsClean, runStory).map((a) => a.id)).toEqual([
      'miss-late',
      'clean-early',
    ]);
  });

  it('breaks remaining ties by original source order', () => {
    const tie1 = makeAchievement('tie-1', { expectedStage: 'cleanup' });
    const tie2 = makeAchievement('tie-2', { expectedStage: 'cleanup' });
    const set = makeSet([tie1, tie2]);
    const run = makeRun(set, 'default-run', 'story');
    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['tie-1', 'tie-2']);
  });

  it('treats generic warning as non-urgent, caps recommendations at 3, and defaults stage to story', () => {
    const urgAch = makeAchievement('urg-01', { labels: ['point_of_no_return'], expectedStage: 'cleanup' });
    const cautionAch = makeAchievement('caut-01', { labels: ['story'], warning: 'Careful', expectedStage: 'cleanup' });
    const regularAch = makeAchievement('reg-01', { labels: ['story'], expectedStage: 'cleanup' });

    const set = makeSet([regularAch, cautionAch, urgAch]);
    const run = makeRun(set, 'default-run', 'story');
    expect(getRunOracleFocus(set, run).map((a) => a.id)).toEqual(['urg-01', 'reg-01', 'caut-01']);

    const fiveAchs = ['f1', 'f2', 'f3', 'f4', 'f5'].map((id) => makeAchievement(id));
    const fiveSet = makeSet(fiveAchs);
    const focusFive = getRunOracleFocus(fiveSet, makeRun(fiveSet));
    expect(focusFive).toHaveLength(3);
    expect(focusFive.map((a) => a.id)).toEqual(['f1', 'f2', 'f3']);

    const stageTestSet = makeSet([
      makeAchievement('cl-item', {
        tracking: { mode: 'counter', unit: 'items', target: 10 },
        expectedStage: 'cleanup',
      }),
      makeAchievement('st-item', {
        tracking: { mode: 'counter', unit: 'items', target: 10 },
        expectedStage: 'story',
      }),
    ]);
    const undefinedStageRun = makeRun(stageTestSet);
    undefinedStageRun.progress['cl-item'].counter = { certainty: 'exact', value: 3 };
    delete undefinedStageRun.activeStage;
    expect(getRunOracleFocus(stageTestSet, undefinedStageRun).map((a) => a.id)).toEqual(['st-item', 'cl-item']);
  });

  it('maintains strict run and set isolation with divergent prerequisite and partial states without borrowing from orphans or another run', () => {
    const p1 = makeAchievement('p1');
    const d1 = makeAchievement('d1', { prerequisites: ['p1'] });
    const setAlpha = makeSet([p1, d1], 'set-alpha');

    const runA1 = makeRun(setAlpha, 'run-a1');
    const runA2 = makeRun(setAlpha, 'run-a2');

    runA1.progress.p1.completed = true;
    expect(getRunOracleFocus(setAlpha, runA1).map((a) => a.id)).toEqual(['d1']);
    expect(getRunOracleFocus(setAlpha, runA2).map((a) => a.id)).toEqual(['p1']);

    // Divergent partial progress ordering between runs of the same set
    const cnt1 = makeAchievement('c1', {
      tracking: { mode: 'counter', unit: 'items', target: 10 },
      expectedStage: 'cleanup',
    });
    const cnt2 = makeAchievement('c2', {
      tracking: { mode: 'counter', unit: 'items', target: 10 },
      expectedStage: 'cleanup',
    });
    const setCounters = makeSet([cnt1, cnt2], 'set-counters');
    const runOrder1 = makeRun(setCounters, 'order-1', 'story');
    const runOrder2 = makeRun(setCounters, 'order-2', 'story');

    runOrder1.progress.c1.counter = { certainty: 'exact', value: 2 };
    runOrder2.progress.c2.counter = { certainty: 'exact', value: 2 };
    expect(getRunOracleFocus(setCounters, runOrder1).map((a) => a.id)).toEqual(['c1', 'c2']);
    expect(getRunOracleFocus(setCounters, runOrder2).map((a) => a.id)).toEqual(['c2', 'c1']);

    // Separate set isolation
    const pBeta = makeAchievement('pb');
    const setBeta = makeSet([pBeta], 'set-beta');
    const runBeta = makeRun(setBeta, 'run-beta');
    expect(getRunOracleFocus(setBeta, runBeta).map((a) => a.id)).toEqual(['pb']);

    // Orphan progress does not satisfy prerequisites
    runA2.orphanedProgress = { p1: [makeOrphan('p1', 'binary')] };
    expect(getRunOracleFocus(setAlpha, runA2).map((a) => a.id)).toEqual(['p1']);
  });

  it('guarantees input immutability, repeated determinism, fresh result array, and definition-reference ownership', () => {
    const a1 = makeAchievement('a1');
    const a2 = makeAchievement('a2');
    const set = makeSet([a1, a2]);
    const run = makeRun(set);

    const setSnapshot = JSON.stringify(set);
    const runSnapshot = JSON.stringify(run);

    Object.freeze(set);
    Object.freeze(set.achievements);
    set.achievements.forEach((achievement) => Object.freeze(achievement));

    const res1 = getRunOracleFocus(set, run);
    const res2 = getRunOracleFocus(set, run);

    expect(JSON.stringify(set)).toBe(setSnapshot);
    expect(JSON.stringify(run)).toBe(runSnapshot);
    expect(res1.map((a) => a.id)).toEqual(res2.map((a) => a.id));
    expect(res1).not.toBe(res2);
    expect(res1[0]).toBe(set.achievements[0]);
    expect(res1[1]).toBe(set.achievements[1]);
  });
});
