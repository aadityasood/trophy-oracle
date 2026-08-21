import { describe, expect, it } from 'vitest';
import {
  NonBlankStringSchema,
  ProgressProvenanceSchema,
  distinctNonBlankIds,
  isIsoUtcString,
} from './progress-schema-common';

describe('progress schema common primitives', () => {
  it('accepts real UTC timestamps and rejects offsets and impossible calendar values', () => {
    expect(isIsoUtcString('2026-07-22T12:00:00Z')).toBe(true);
    expect(isIsoUtcString('2026-07-22T12:00:00.123456Z')).toBe(true);
    expect(isIsoUtcString('2026-07-22T12:00:00.123456+00:00')).toBe(true);
    expect(isIsoUtcString('2024-02-29T23:59:59+00:00')).toBe(true);

    expect(isIsoUtcString('0000-01-01T00:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-00-22T12:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-13-22T12:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-02-29T12:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-04-31T12:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-07-22T24:00:00Z')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:60:00Z')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:00:60Z')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:00:00-00:00')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:00:00-05:00')).toBe(false);
    expect(isIsoUtcString('2026-07-22T12:00:00+05:30')).toBe(false);
    expect(isIsoUtcString('2026-07-22')).toBe(false);
  });

  it('rejects whitespace-only strings and accepts any nonblank string', () => {
    const whitespaceOnly = NonBlankStringSchema.safeParse('   ');
    expect(whitespaceOnly.success).toBe(false);
    if (!whitespaceOnly.success) {
      expect(whitespaceOnly.error.issues[0]?.message).toBe(
        'Must contain at least one non-whitespace character',
      );
    }
    expect(NonBlankStringSchema.safeParse('\t\n ').success).toBe(false);
    expect(NonBlankStringSchema.safeParse('').success).toBe(false);

    expect(NonBlankStringSchema.safeParse('achievement-1').success).toBe(true);
    expect(NonBlankStringSchema.safeParse('  padded  ').success).toBe(true);
  });

  it('rejects duplicate and blank IDs and accepts distinct IDs', () => {
    expect(distinctNonBlankIds.safeParse(['a', 'b']).success).toBe(true);
    expect(distinctNonBlankIds.safeParse([]).success).toBe(true);

    const duplicateIds = distinctNonBlankIds.safeParse(['a', 'a']);
    expect(duplicateIds.success).toBe(false);
    if (!duplicateIds.success) {
      expect(duplicateIds.error.issues[0]?.message).toBe(
        'IDs must be distinct',
      );
    }
    expect(distinctNonBlankIds.safeParse(['a', 'b', 'a']).success).toBe(false);
    expect(distinctNonBlankIds.safeParse([' ']).success).toBe(false);
  });

  it('accepts the three provenance values and rejects unsupported values', () => {
    expect(ProgressProvenanceSchema.safeParse('manual').success).toBe(true);
    expect(ProgressProvenanceSchema.safeParse('imported').success).toBe(true);
    expect(ProgressProvenanceSchema.safeParse('platform').success).toBe(true);

    expect(ProgressProvenanceSchema.safeParse('ai').success).toBe(false);
    expect(ProgressProvenanceSchema.safeParse('unknown').success).toBe(false);
  });
});
