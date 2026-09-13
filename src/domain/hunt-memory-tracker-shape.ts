import type { TrackingConfiguration } from './achievement-schema';
import type { AchievementProgressV3 } from './hunt-memory-schema';

export function validateTrackerShape(
  progress: AchievementProgressV3,
  tracking: TrackingConfiguration,
): boolean {
  if (tracking.mode === 'binary') {
    return (
      progress.counter === undefined &&
      progress.checklistCompletion === undefined &&
      !progress.manualOverride
    );
  }

  if (tracking.mode === 'counter') {
    return (
      progress.counter !== undefined &&
      progress.checklistCompletion === undefined
    );
  }

  const checklist = progress.checklistCompletion;
  if (progress.counter !== undefined || checklist === undefined) {
    return false;
  }
  const expectedIds = tracking.items.map((item) => item.id);
  const actualKeys = Object.keys(checklist);
  return (
    actualKeys.length === expectedIds.length &&
    expectedIds.every((id) => Object.hasOwn(checklist, id))
  );
}
