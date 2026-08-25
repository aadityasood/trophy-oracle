import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  NonBlankStringSchema,
  PersistedRecordKeySchema,
  ProgressProvenanceSchema,
  RESERVED_RECORD_KEY,
  RESERVED_RECORD_KEY_MESSAGE,
  distinctNonBlankIds,
  isIsoUtcString,
  isReservedRecordKey,
  safeRecord,
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

  it('identifies only the exact reserved record key', () => {
    expect(isReservedRecordKey('__proto__')).toBe(true);

    expect(isReservedRecordKey('constructor')).toBe(false);
    expect(isReservedRecordKey('toString')).toBe(false);
    expect(isReservedRecordKey('__proto__ ')).toBe(false);
    expect(isReservedRecordKey(' __proto__')).toBe(false);
    expect(isReservedRecordKey('__PROTO__')).toBe(false);
    expect(isReservedRecordKey('')).toBe(false);
    expect(isReservedRecordKey('prototype')).toBe(false);
  });

  it('rejects only the reserved persisted identity string', () => {
    const reserved = PersistedRecordKeySchema.safeParse(RESERVED_RECORD_KEY);
    expect(reserved.success).toBe(false);
    if (!reserved.success) {
      expect(reserved.error.issues[0]?.message).toBe(
        RESERVED_RECORD_KEY_MESSAGE,
      );
    }

    expect(PersistedRecordKeySchema.safeParse('constructor').success).toBe(
      true,
    );
    expect(PersistedRecordKeySchema.safeParse('toString').success).toBe(true);
    expect(PersistedRecordKeySchema.safeParse('ordinary-id').success).toBe(
      true,
    );
  });

  it('rejects an own reserved key with a stable message and path before record parsing', () => {
    const schema = safeRecord(z.boolean());
    const hostile = JSON.parse('{"__proto__": true, "ok": false}');

    const result = schema.safeParse(hostile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.message).toBe(
        RESERVED_RECORD_KEY_MESSAGE,
      );
      expect(result.error.issues[0]?.path).toEqual([RESERVED_RECORD_KEY]);
    }

    expect(Object.hasOwn(hostile, RESERVED_RECORD_KEY)).toBe(true);
    expect(Object.getPrototypeOf(hostile)).toBe(Object.prototype);
  });

  it('prefixes the reserved-key path when the helper is nested under an object property', () => {
    const schema = z.strictObject({ map: safeRecord(z.boolean()) });
    const hostile = { map: JSON.parse('{"__proto__": true}') };

    const result = schema.safeParse(hostile);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.message).toBe(RESERVED_RECORD_KEY_MESSAGE);
      expect(issue?.path).toEqual(['map', RESERVED_RECORD_KEY]);
    }
  });

  it('accepts own constructor and toString record keys and preserves plain-object output', () => {
    const schema = safeRecord(z.boolean());
    const value = { constructor: true, toString: false, ok: true };

    const result = schema.safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(value);
      expect(Object.hasOwn(result.data, 'constructor')).toBe(true);
      expect(Object.hasOwn(result.data, 'toString')).toBe(true);
      expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    }
  });

  it('does not change validation of blank keys or invalid values', () => {
    const schema = safeRecord(z.boolean());

    expect(schema.safeParse({ ' ': true }).success).toBe(false);
    expect(schema.safeParse({ ok: 'not-a-boolean' }).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse('not-an-object').success).toBe(false);
  });
});
