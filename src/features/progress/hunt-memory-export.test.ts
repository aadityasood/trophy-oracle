import { describe, expect, it, vi } from 'vitest';
import type { ProgressV3CutoverRecord } from '../../data/hunt-memory-storage';
import { createDefaultHuntMemoryStore } from '../../data/hunt-memory-storage';
import {
  defaultRawDownload,
  getRawExportOptions,
} from './hunt-memory-export';
import type {
  FailureHookState,
  FreshHookState,
  ReadyHookState,
  RecoveryRequiredHookState,
  UpgradeRequiredHookState,
  ViewOnlyHookState,
} from './use-hunt-memory-store';

const defaultStore = createDefaultHuntMemoryStore();

const migratedCutoverRecord: ProgressV3CutoverRecord = {
  recordVersion: 1,
  source: 'migrated-v2',
  rawV2: '{"schemaVersion":"2.0","gameProgress":{},"backup":true}',
};

const freshCutoverRecord: ProgressV3CutoverRecord = {
  recordVersion: 1,
  source: 'fresh',
};

describe('hunt-memory-export', () => {
  describe('getRawExportOptions', () => {
    it('returns empty array when no raw strings exist in fresh state', () => {
      const freshState: FreshHookState = {
        status: 'fresh',
        store: defaultStore,
        v3Token: null,
      };
      expect(getRawExportOptions(freshState)).toEqual([]);
    });

    it('returns only current V2 option for upgrade-required state', () => {
      const upgradeState: UpgradeRequiredHookState = {
        status: 'upgrade-required',
        store: defaultStore,
        candidateStore: defaultStore,
        v2Token: '{"schemaVersion":"2.0","upgradable":true}',
        report: {
          sourceSchemaVersion: '2.0',
          targetSchemaVersion: '3.0',
          migratedAt: '2026-09-28T12:00:00.000Z',
          migratedGameIds: [],
          migratedSets: [],
          createdRuns: [],
          counterAssumptions: [],
          preservedUndoTargets: [],
          warnings: [],
        },
      };

      const options = getRawExportOptions(upgradeState);
      expect(options).toHaveLength(1);
      expect(options[0]).toEqual({
        id: 'v2-current',
        label: 'Current V2 progress',
        filename: 'trophy-oracle-progress-v2-current.json',
        rawBytes: '{"schemaVersion":"2.0","upgradable":true}',
        description: 'Current raw Schema 2.0 progress stored under the live V2 key.',
      });
    });

    it('preserves present empty-string raw values unlike absent keys', () => {
      const recoveryWithEmptyV3: RecoveryRequiredHookState = {
        status: 'recovery-required',
        reason: 'INVALID_V3',
        message: 'Empty V3 stored string',
        store: null,
        rawV3: '',
        rawCutover: null,
        rawV2: null,
      };

      const options = getRawExportOptions(recoveryWithEmptyV3);
      expect(options).toHaveLength(1);
      expect(options[0]).toEqual({
        id: 'v3',
        label: 'Authoritative V3 progress',
        filename: 'trophy-oracle-progress-v3.json',
        rawBytes: '',
        description: 'Authoritative Schema 3.0 progress stored under the active V3 key.',
      });

      const failureWithEmptyKeys: FailureHookState = {
        status: 'failure',
        code: 'STORAGE_ACCESS_ERROR',
        message: 'Corrupted empty storage values',
        store: null,
        rawV2: '',
        rawCutover: '',
        rawV3: null,
      };

      const failureOptions = getRawExportOptions(failureWithEmptyKeys);
      expect(failureOptions.map((o) => o.id)).toEqual(['v2-current', 'cutover-record']);
      expect(failureOptions[0].rawBytes).toBe('');
      expect(failureOptions[1].rawBytes).toBe('');
    });

    it('returns all 4 distinct options for migrated ready state with V2 intact', () => {
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0","active":true}',
        cutoverRecord: migratedCutoverRecord,
        legacyV2Status: 'unchanged',
        rawV2: migratedCutoverRecord.rawV2,
        rawCutover: JSON.stringify(migratedCutoverRecord),
      };

      const options = getRawExportOptions(readyState);
      expect(options.map((o) => o.id)).toEqual([
        'v2-current',
        'v2-cutover-backup',
        'v3',
        'cutover-record',
      ]);
      expect(options[0].filename).toBe('trophy-oracle-progress-v2-current.json');
      expect(options[1].filename).toBe('trophy-oracle-progress-v2-cutover-backup.json');
      expect(options[2].filename).toBe('trophy-oracle-progress-v3.json');
      expect(options[3].filename).toBe('trophy-oracle-progress-v3-cutover-record.json');
    });

    it('preserves distinct bytes when legacy V2 diverges from cutover backup', () => {
      const divergentV2 = '{"schemaVersion":"2.0","divergent":true}';
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
        cutoverRecord: migratedCutoverRecord,
        legacyV2Status: 'changed',
        rawV2: divergentV2,
        rawCutover: JSON.stringify(migratedCutoverRecord),
      };

      const options = getRawExportOptions(readyState);
      const currentV2Opt = options.find((o) => o.id === 'v2-current');
      const backupV2Opt = options.find((o) => o.id === 'v2-cutover-backup');

      expect(currentV2Opt?.rawBytes).toBe(divergentV2);
      expect(backupV2Opt?.rawBytes).toBe(migratedCutoverRecord.rawV2);
      expect(currentV2Opt?.rawBytes).not.toBe(backupV2Opt?.rawBytes);
    });

    it('omits V2 current and backup options when fresh cutover has no V2', () => {
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
        cutoverRecord: freshCutoverRecord,
        legacyV2Status: 'not-applicable',
        rawV2: null,
        rawCutover: JSON.stringify(freshCutoverRecord),
      };

      const options = getRawExportOptions(readyState);
      expect(options.map((o) => o.id)).toEqual(['v3', 'cutover-record']);
    });

    it('extracts invalid raw V3 text in recovery-required state without parsing error', () => {
      const malformedJson = '{"schemaVersion": "3.0", BROKEN_SYNTAX';
      const recoveryState: RecoveryRequiredHookState = {
        status: 'recovery-required',
        reason: 'INVALID_V3',
        message: 'Failed to parse V3 JSON',
        store: null,
        rawV3: malformedJson,
      };

      const options = getRawExportOptions(recoveryState);
      expect(options).toHaveLength(1);
      expect(options[0].id).toBe('v3');
      expect(options[0].rawBytes).toBe(malformedJson);
    });

    it('extracts available raw strings for failure and view-only states', () => {
      const failureState: FailureHookState = {
        status: 'failure',
        code: 'STORAGE_ACCESS_ERROR',
        message: 'Access denied',
        store: null,
        rawV2: 'legacy-v2-raw',
        rawCutover: 'cutover-raw',
      };
      expect(getRawExportOptions(failureState).map((o) => o.id)).toEqual([
        'v2-current',
        'cutover-record',
      ]);

      const viewOnlyState: ViewOnlyHookState = {
        status: 'view-only',
        reason: 'LOCK_UNAVAILABLE',
        message: 'Web Locks API unavailable',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
      };
      expect(getRawExportOptions(viewOnlyState).map((o) => o.id)).toEqual(['v3']);
      const v2Token = ' \r\n{"schemaVersion":"2.0"}\t';
      const v2Options = getRawExportOptions({ ...viewOnlyState, v3Token: undefined, v2Token });
      expect(v2Options).toHaveLength(1);
      expect(v2Options[0]).toMatchObject({
        id: 'v2-current',
        filename: 'trophy-oracle-progress-v2-current.json',
        rawBytes: v2Token,
      });
    });
  });

  describe('defaultRawDownload', () => {
    it('creates Blob with application/json, triggers anchor click, and cleans up URL', () => {
      const mockCreateObjectURL = vi.fn((blob: Blob) => `blob:mock-url-${blob.size}`);
      const mockRevokeObjectURL = vi.fn();
      window.URL.createObjectURL = mockCreateObjectURL;
      window.URL.revokeObjectURL = mockRevokeObjectURL;

      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      const testContent = '{"schemaVersion":"3.0","exact":true}';
      const testFilename = 'trophy-oracle-progress-v3.json';

      defaultRawDownload(testFilename, testContent);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const passedBlob = mockCreateObjectURL.mock.calls[0][0] as Blob;
      expect(passedBlob.type).toBe('application/json;charset=utf-8');

      expect(appendChildSpy).toHaveBeenCalled();
      const link = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      expect(link.tagName).toBe('A');
      expect(link.download).toBe(testFilename);
      expect(link.href).toContain('blob:mock-url-');

      expect(removeChildSpy).toHaveBeenCalledWith(link);
      expect(mockRevokeObjectURL).toHaveBeenCalledWith(link.href);

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });

    it('classifies invalid JSON raw text with text/plain mime type', () => {
      const mockCreateObjectURL = vi.fn((blob: Blob) => `blob:mock-url-${blob.size}`);
      window.URL.createObjectURL = mockCreateObjectURL;
      window.URL.revokeObjectURL = vi.fn();

      const invalidJson = '{ not valid json';
      defaultRawDownload('trophy-oracle-progress-v3.json', invalidJson);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const passedBlob = mockCreateObjectURL.mock.calls[0][0] as Blob;
      expect(passedBlob.type).toBe('text/plain;charset=utf-8');
    });

    it('throws error when URL.createObjectURL is unavailable', () => {
      const originalCreate = window.URL.createObjectURL;
      // @ts-expect-error test unavailable object URL environment
      window.URL.createObjectURL = undefined;

      try {
        expect(() => {
          defaultRawDownload('trophy-oracle-progress-v3.json', '{}');
        }).toThrow(/URL\.createObjectURL is unavailable in this environment/i);
      } finally {
        window.URL.createObjectURL = originalCreate;
      }
    });
  });
});
