import { z } from 'zod';

export const NonBlankStringSchema = z.string().refine(
  (value) => value.trim().length > 0,
  { message: 'Must contain at least one non-whitespace character' },
);

export const distinctNonBlankIds = z
  .array(NonBlankStringSchema)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'IDs must be distinct',
  });

export function isIsoUtcString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|\+00:00)$/.exec(
    value,
  );
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day >= 1 && day <= daysInMonth[month - 1];
}

export const ProgressProvenanceSchema = z.enum(['manual', 'imported', 'platform']);
export type ProgressProvenance = z.infer<typeof ProgressProvenanceSchema>;
