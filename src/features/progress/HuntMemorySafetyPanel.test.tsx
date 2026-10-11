import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ProgressV3CutoverRecordSchema,
  createDefaultHuntMemoryStore,
  type ProgressV3CutoverRecord,
} from '../../data/hunt-memory-storage';
import {
  LocalProgressStoreV3Schema,
  type LocalProgressStoreV3,
} from '../../domain/hunt-memory-schema';
import { createDefaultGameProgressV3 } from '../../domain/hunt-memory-lifecycle';
import { mockGameStellarDrift, MOCK_TIMESTAMP } from '../../test/progress-fixtures';
import { HuntMemorySafetyPanel } from './HuntMemorySafetyPanel';
import type {
  FailureHookState,
  FreshHookState,
  HuntMemoryActionResult,
  HuntMemoryDiscardResult,
  HuntMemoryDiscriminatedState,
  ReadyHookState,
  RecoveryRequiredHookState,
  UpgradeRequiredHookState,
  UseHuntMemoryStoreResult,
  ViewOnlyHookState,
} from './use-hunt-memory-store';

const defaultStore: LocalProgressStoreV3 = createDefaultHuntMemoryStore();
LocalProgressStoreV3Schema.parse(defaultStore);

const distinctStoreWithProgress: LocalProgressStoreV3 = {
  ...defaultStore,
  lastGameId: mockGameStellarDrift.id,
  gameProgress: {
    [mockGameStellarDrift.id]: createDefaultGameProgressV3(mockGameStellarDrift, MOCK_TIMESTAMP),
  },
};
LocalProgressStoreV3Schema.parse(distinctStoreWithProgress);

const migratedCutoverRecord: ProgressV3CutoverRecord = {
  recordVersion: 1,
  source: 'migrated-v2',
  rawV2: '{"schemaVersion":"2.0","gameProgress":{},"backup":true}',
};
ProgressV3CutoverRecordSchema.parse(migratedCutoverRecord);

const freshCutoverRecord: ProgressV3CutoverRecord = {
  recordVersion: 1,
  source: 'fresh',
};
ProgressV3CutoverRecordSchema.parse(freshCutoverRecord);

const baseUpgradeState: UpgradeRequiredHookState = {
  status: 'upgrade-required',
  store: defaultStore,
  candidateStore: defaultStore,
  v2Token: '{"schemaVersion":"2.0","gameProgress":{}}',
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

const defaultReadyState: ReadyHookState = {
  status: 'ready',
  store: defaultStore,
  v3Token: '{"schemaVersion":"3.0"}',
  cutoverRecord: freshCutoverRecord,
  legacyV2Status: 'not-applicable',
  rawV2: null,
  rawCutover: JSON.stringify(freshCutoverRecord),
};

describe('HuntMemorySafetyPanel', () => {
  describe('fresh state', () => {
    const freshState: FreshHookState = {
      status: 'fresh',
      store: defaultStore,
      v3Token: null,
    };

    it('renders truthful unsaved status without claiming V3 exists or showing upgrade', () => {
      const onUpgrade = vi.fn();
      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={freshState}
          onUpgrade={onUpgrade}
        />,
      );

      expect(
        screen.getByRole('heading', { level: 2, name: /hunt memory safety status/i }),
      ).toBeInTheDocument();
      expect(screen.getByText('Unsaved')).toBeInTheDocument();
      expect(
        screen.getByText(/no saved progress/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /no progress is saved to local storage yet\. a progress change is saved only after storage confirms it/i,
        ),
      ).toBeInTheDocument();

      expect(
        screen.queryByRole('button', { name: /upgrade/i }),
      ).not.toBeInTheDocument();
      expect(onUpgrade).not.toHaveBeenCalled();

      rerender(
        <HuntMemorySafetyPanel
          state={freshState}
          isStale={true}
          onUpgrade={onUpgrade}
        />,
      );
      expect(screen.getByText('Storage unverified')).toBeInTheDocument();
      expect(screen.queryByText('Unsaved')).not.toBeInTheDocument();
      expect(screen.getByText(/storage status \(unconfirmed\)/i)).toBeInTheDocument();
      expect(screen.queryByText(/^no saved progress$/i)).not.toBeInTheDocument();
      expect(
        screen.getByText(/at the last check, no progress was saved to storage\. current storage is unconfirmed\./i),
      ).toBeInTheDocument();
      expect(screen.queryByText(/no progress is saved to local storage yet/i)).not.toBeInTheDocument();
      expect(onUpgrade).not.toHaveBeenCalled();
    });

    it('renders no export controls when bytes are absent', () => {
      render(<HuntMemorySafetyPanel state={freshState} />);

      expect(
        screen.getByText(/no raw storage files are available for export/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^export/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('upgrade-required state', () => {
    const upgradeState: UpgradeRequiredHookState = {
      status: 'upgrade-required',
      store: defaultStore,
      candidateStore: defaultStore,
      v2Token: '{"schemaVersion":"2.0","gameProgress":{}}',
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

    it('renders preview status, close tabs warning, and explicit upgrade command', async () => {
      const user = userEvent.setup();
      const onUpgrade = vi.fn().mockResolvedValue({ status: 'success', store: defaultStore });

      render(
        <HuntMemorySafetyPanel
          state={upgradeState}
          onUpgrade={onUpgrade}
        />,
      );

      expect(
        screen.getByText(/earlier version progress detected \(preview only\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/please close other open trophy oracle browser tabs/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/you may export your original data below/i),
      ).toBeInTheDocument();

      const upgradeButton = screen.getByRole('button', {
        name: /upgrade/i,
      });
      expect(upgradeButton).toBeEnabled();
      expect(onUpgrade).not.toHaveBeenCalled();

      await user.click(upgradeButton);
      expect(onUpgrade).toHaveBeenCalledTimes(1);
    });

    it('disables upgrade command when callback is missing or when stale', () => {
      const { rerender } = render(
        <HuntMemorySafetyPanel state={upgradeState} />,
      );

      const upgradeButton = screen.getByRole('button', {
        name: /upgrade/i,
      });
      expect(upgradeButton).toBeDisabled();

      const onUpgrade = vi.fn();
      rerender(
        <HuntMemorySafetyPanel
          state={upgradeState}
          isStale={true}
          onUpgrade={onUpgrade}
        />,
      );
      expect(
        screen.getByRole('button', { name: /upgrade/i }),
      ).toBeDisabled();
    });

    it('disables upgrade command while busy and handles error without claiming early success', async () => {
      const user = userEvent.setup();
      const onUpgrade = vi
        .fn()
        .mockResolvedValue({ status: 'blocked', reason: 'LOCK_TIMEOUT', message: 'Storage lock acquisition timed out' });

      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={upgradeState}
          onUpgrade={onUpgrade}
        />,
      );

      const upgradeButton = screen.getByRole('button', {
        name: /upgrade/i,
      });
      await user.click(upgradeButton);

      const errorAlert = await screen.findByRole('alert');
      expect(errorAlert).toHaveTextContent(/upgrade was prevented by storage safety restrictions/i);
      expect(screen.queryByText(/upgraded successfully/i)).not.toBeInTheDocument();

      rerender(
        <HuntMemorySafetyPanel
          state={upgradeState}
          isBusy={true}
          onUpgrade={onUpgrade}
        />,
      );
      expect(
        screen.getByRole('button', { name: /upgrade/i }),
      ).toBeDisabled();
    });

    it('offers exact export for current V2 progress only', async () => {
      const user = userEvent.setup();
      const onDownload = vi.fn();

      render(
        <HuntMemorySafetyPanel
          state={upgradeState}
          onDownload={onDownload}
        />,
      );

      expect(
        screen.getByRole('heading', { level: 3, name: /raw storage exports \(1\)/i }),
      ).toBeInTheDocument();

      const exportBtn = screen.getByRole('button', {
        name: /export retained v2 progress as trophy-oracle-progress-v2-current\.json/i,
      });
      expect(exportBtn).toBeInTheDocument();
      expect(screen.queryByText(/cutover v2 backup/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/authoritative v3 progress/i)).not.toBeInTheDocument();

      await user.click(exportBtn);
      expect(onDownload).toHaveBeenCalledWith(
        'trophy-oracle-progress-v2-current.json',
        upgradeState.v2Token,
      );
      expect(
        screen.getByRole('status'),
      ).toHaveTextContent(/download requested for trophy-oracle-progress-v2-current\.json\. completion is not confirmed\./i);
    });
  });

  describe('ready state', () => {
    it('preserves four distinct migrated exports as storage becomes unverified', async () => {
      const user = userEvent.setup();
      const onDownload = vi.fn();
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0","authoritative":true}',
        cutoverRecord: migratedCutoverRecord,
        legacyV2Status: 'unchanged',
        rawV2: migratedCutoverRecord.rawV2,
        rawCutover: JSON.stringify(migratedCutoverRecord),
      };

      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={readyState}
          onDownload={onDownload}
        />,
      );

      expect(
        screen.getByText(/saved progress active/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/at the last check, the legacy v2 key matched the cutover backup/i),
      ).toBeInTheDocument();

      const exportsHeading = screen.getByRole('heading', {
        level: 3,
        name: /raw storage exports \(4\)/i,
      });
      expect(exportsHeading).toBeInTheDocument();

      const v2CurrentBtn = screen.getByRole('button', {
        name: /export retained v2 progress as trophy-oracle-progress-v2-current\.json/i,
      });
      const v2BackupBtn = screen.getByRole('button', {
        name: /export cutover v2 backup as trophy-oracle-progress-v2-cutover-backup\.json/i,
      });
      const v3Btn = screen.getByRole('button', {
        name: /export raw v3 progress as trophy-oracle-progress-v3\.json/i,
      });
      const cutoverBtn = screen.getByRole('button', {
        name: /export cutover record as trophy-oracle-progress-v3-cutover-record\.json/i,
      });

      await user.click(v2CurrentBtn);
      expect(onDownload).toHaveBeenLastCalledWith(
        'trophy-oracle-progress-v2-current.json',
        migratedCutoverRecord.rawV2,
      );

      await user.click(v2BackupBtn);
      expect(onDownload).toHaveBeenLastCalledWith(
        'trophy-oracle-progress-v2-cutover-backup.json',
        migratedCutoverRecord.rawV2,
      );

      await user.click(v3Btn);
      expect(onDownload).toHaveBeenLastCalledWith(
        'trophy-oracle-progress-v3.json',
        readyState.v3Token,
      );

      await user.click(cutoverBtn);
      expect(onDownload).toHaveBeenLastCalledWith(
        'trophy-oracle-progress-v3-cutover-record.json',
        readyState.rawCutover,
      );

      rerender(<HuntMemorySafetyPanel state={readyState} isStale onDownload={onDownload} />);
      expect(screen.getByText(/at the last check, the legacy v2 key matched the cutover backup/i)).toBeInTheDocument();
      expect(screen.queryByText(/legacy v2 key matches the cutover backup/i)).not.toBeInTheDocument();
      expect(screen.getByText(/current storage cannot be verified/i)).toBeInTheDocument();
      expect(exportsHeading).toHaveTextContent('Raw Storage Exports (4)');
      for (const [button, filename, bytes] of [
        [v2CurrentBtn, 'trophy-oracle-progress-v2-current.json', readyState.rawV2],
        [v2BackupBtn, 'trophy-oracle-progress-v2-cutover-backup.json', migratedCutoverRecord.rawV2],
        [v3Btn, 'trophy-oracle-progress-v3.json', readyState.v3Token],
        [cutoverBtn, 'trophy-oracle-progress-v3-cutover-record.json', readyState.rawCutover],
      ] as const) {
        await user.click(button);
        expect(onDownload).toHaveBeenLastCalledWith(filename, bytes);
      }

      rerender(
        <HuntMemorySafetyPanel state={{ ...readyState, legacyV2Status: 'missing', rawV2: null }} isStale onDownload={onDownload} />,
      );
      expect(screen.getByText(/at the last check, the legacy v2 key was absent from storage/i)).toBeInTheDocument();
      expect(screen.queryByText(/legacy v2 key is absent from storage/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /export retained v2 progress/i })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /export cutover v2 backup/i }));
      expect(onDownload).toHaveBeenLastCalledWith('trophy-oracle-progress-v2-cutover-backup.json', migratedCutoverRecord.rawV2);
    });

    it('preserves distinct export choices and warns when legacy V2 diverges from cutover backup', async () => {
      const user = userEvent.setup();
      const onDownload = vi.fn();
      const divergentV2 = '{"schemaVersion":"2.0","divergentEdit":true}';
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
        cutoverRecord: migratedCutoverRecord,
        legacyV2Status: 'changed',
        legacyV2Warning:
          'Legacy V2 progress has changed since cutover. Schema 3.0 remains authoritative.',
        rawV2: divergentV2,
        rawCutover: JSON.stringify(migratedCutoverRecord),
      };

      render(
        <HuntMemorySafetyPanel
          state={readyState}
          onDownload={onDownload}
        />,
      );

      expect(
        screen.getByRole('alert'),
      ).toHaveTextContent(/at the last check, legacy v2 progress differed from the cutover backup/i);

      const v2CurrentBtn = screen.getByRole('button', {
        name: /export retained v2 progress/i,
      });
      const v2BackupBtn = screen.getByRole('button', {
        name: /export cutover v2 backup/i,
      });

      await user.click(v2CurrentBtn);
      expect(onDownload).toHaveBeenLastCalledWith(
        'trophy-oracle-progress-v2-current.json',
        divergentV2,
      );

      await user.click(v2BackupBtn);
      expect(onDownload).toHaveBeenLastCalledWith(
        'trophy-oracle-progress-v2-cutover-backup.json',
        migratedCutoverRecord.rawV2,
      );

      expect(divergentV2).not.toEqual(migratedCutoverRecord.rawV2);
    });

    it('offers only V3 and cutover record exports for fresh cutover with no V2', () => {
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
        cutoverRecord: freshCutoverRecord,
        legacyV2Status: 'not-applicable',
        rawV2: null,
        rawCutover: JSON.stringify(freshCutoverRecord),
      };

      render(<HuntMemorySafetyPanel state={readyState} />);

      expect(
        screen.getByRole('heading', { level: 3, name: /raw storage exports \(2\)/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /export raw v3 progress/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /export cutover record/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /cutover v2 backup/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /retained v2 progress/i }),
      ).not.toBeInTheDocument();
    });

    it('shows warning when legacy V2 read is unavailable', () => {
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
        cutoverRecord: migratedCutoverRecord,
        legacyV2Status: 'unavailable',
        legacyV2Warning: 'Could not check older V2 progress: Storage restricted',
        rawV2: null,
        rawCutover: JSON.stringify(migratedCutoverRecord),
      };

      render(<HuntMemorySafetyPanel state={readyState} />);

      expect(
        screen.getByRole('alert'),
      ).toHaveTextContent(/could not check older v2 progress/i);
    });
  });

  describe('recovery-required state', () => {
    it('truthfully conveys typed reasons, no-saving posture, reload command, and raw exports', async () => {
      const user = userEvent.setup();
      const onReload = vi.fn();
      const onDownload = vi.fn();
      const recoveryState: RecoveryRequiredHookState = {
        status: 'recovery-required',
        reason: 'CUTOVER_WITHOUT_V3',
        message: 'Cutover record present without V3 store',
        store: null,
        rawCutover: JSON.stringify(migratedCutoverRecord),
        cutoverRecord: migratedCutoverRecord,
        conflicts: ['trophy-oracle.progress.v3 is missing'],
      };

      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={recoveryState}
          onReload={onReload}
          onDownload={onDownload}
        />,
      );

      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(/recovery required: saving disabled/i)).toBeInTheDocument();
      expect(within(alert).getByText(/saving is disabled/i)).toBeInTheDocument();
      expect(
        within(alert).getByText(/at the last check, cutover metadata existed without saved progress\. storage could not be verified\./i),
      ).toBeInTheDocument();
      expect(within(alert).queryByText('trophy-oracle.progress.v3 is missing')).not.toBeInTheDocument();

      const reloadBtn = within(alert).getByRole('button', { name: /reload application/i });
      await user.click(reloadBtn);
      expect(onReload).toHaveBeenCalledTimes(1);

      rerender(
        <HuntMemorySafetyPanel
          state={recoveryState}
          isStale={true}
          onReload={onReload}
          onDownload={onDownload}
        />,
      );
      expect(within(alert).getByText(/at the last check, cutover metadata existed without saved progress\. storage could not be verified\./i)).toBeInTheDocument();
      expect(within(alert).queryByText(/cutover metadata exists without saved progress/i)).not.toBeInTheDocument();
      expect(onReload).toHaveBeenCalledTimes(1);
      expect(onDownload).not.toHaveBeenCalled();

      for (const [r, re] of [
        ['INVALID_CUTOVER_WITHOUT_V3', /cutover metadata was unreadable and saved progress was missing/i],
        ['V3_WITH_INVALID_CUTOVER', /cutover metadata was unreadable while saved progress existed/i],
        ['RECORD_WRITE_DIFFERENT', /cutover metadata in storage did not match the expected record/i],
      ] as const) {
        rerender(<HuntMemorySafetyPanel state={{ ...recoveryState, reason: r }} onReload={onReload} onDownload={onDownload} />);
        expect(within(alert).getByText(re)).toBeInTheDocument();
      }

      expect(
        screen.getByRole('button', { name: /export cutover record/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /export cutover v2 backup/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /export raw v3 progress/i }),
      ).not.toBeInTheDocument();
    });

    it('exports invalid raw V3 JSON unchanged as raw text without crashing', async () => {
      const user = userEvent.setup();
      const onDownload = vi.fn();
      const malformedJson = '{"schemaVersion": "3.0", UNCLOSED_BRACKET';
      const recoveryState: RecoveryRequiredHookState = {
        status: 'recovery-required',
        reason: 'INVALID_V3',
        message: 'Failed to parse V3 JSON',
        store: null,
        rawV3: malformedJson,
      };

      render(
        <HuntMemorySafetyPanel
          state={recoveryState}
          onDownload={onDownload}
        />,
      );

      expect(
        screen.getByText(/at the last check, saved progress data was corrupted or unreadable/i),
      ).toBeInTheDocument();

      const v3ExportBtn = screen.getByRole('button', {
        name: /export raw v3 progress/i,
      });
      await user.click(v3ExportBtn);

      expect(onDownload).toHaveBeenCalledWith(
        'trophy-oracle-progress-v3.json',
        malformedJson,
      );
    });

    it('exports present empty raw V3 text without dropping it', async () => {
      const user = userEvent.setup();
      const onDownload = vi.fn();
      const recoveryState: RecoveryRequiredHookState = {
        status: 'recovery-required',
        reason: 'INVALID_V3',
        message: 'Empty V3 text',
        store: null,
        rawV3: '',
      };

      render(
        <HuntMemorySafetyPanel
          state={recoveryState}
          onDownload={onDownload}
        />,
      );

      const v3ExportBtn = screen.getByRole('button', {
        name: /export raw v3 progress/i,
      });
      await user.click(v3ExportBtn);

      expect(onDownload).toHaveBeenCalledWith(
        'trophy-oracle-progress-v3.json',
        '',
      );
    });

    it('never enables save retry for a pending candidate in recovery-required state, but allows discard', async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      const onDiscard = vi.fn().mockReturnValue({ status: 'success' });
      const recoveryState: RecoveryRequiredHookState = {
        status: 'recovery-required',
        reason: 'V3_WITHOUT_CUTOVER',
        message: 'Storage damaged',
        store: null,
      };
      const candidate = {
        candidateStore: defaultStore,
        expectedV3Token: 'tok',
        message: 'Write failed',
      };

      render(
        <HuntMemorySafetyPanel
          state={recoveryState}
          pendingCandidate={candidate}
          onRetry={onRetry}
          onDiscard={onDiscard}
        />,
      );

      expect(screen.getByText(/saving is disabled in this state; retry save is unavailable/i)).toBeInTheDocument();
      expect(
        screen.getByText(/at the last check, saved progress existed without a cutover record/i),
      ).toBeInTheDocument();
      const retryBtn = screen.getByRole('button', { name: /retry save/i });
      const discardBtn = screen.getByRole('button', { name: /discard unsaved change/i });

      expect(retryBtn).toBeDisabled();
      expect(discardBtn).toBeEnabled();

      await user.click(discardBtn);
      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe('view-only and failure states', () => {
    it('renders view-only state with typed reason and no-saving notice', async () => {
      const user = userEvent.setup();
      const onReload = vi.fn();
      const viewOnlyState: ViewOnlyHookState = {
        status: 'view-only',
        reason: 'LOCK_UNAVAILABLE',
        message: 'Web Locks API is unavailable; persistent V3 writes are disabled.',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
      };

      render(
        <HuntMemorySafetyPanel
          state={viewOnlyState}
          onReload={onReload}
        />,
      );

      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(/view-only mode: saving disabled/i)).toBeInTheDocument();
      expect(
        within(alert).getByText(/storage coordination is unavailable in this browser environment/i),
      ).toBeInTheDocument();

      await user.click(within(alert).getByRole('button', { name: /reload application/i }));
      expect(onReload).toHaveBeenCalledTimes(1);

      expect(
        screen.getByRole('button', { name: /export raw v3 progress/i }),
      ).toBeInTheDocument();
    });

    it('renders failure state with code, message, and no-saving notice', () => {
      const failureState: FailureHookState = {
        status: 'failure',
        code: 'STORAGE_ACCESS_ERROR',
        message: 'Permission denied to read storage keys',
        store: null,
        conflicts: ['Key access error'],
      };

      render(<HuntMemorySafetyPanel state={failureState} />);

      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(/storage failure: saving disabled/i)).toBeInTheDocument();
      expect(
        within(alert).getByText(/storage access was denied or failed/i),
      ).toBeInTheDocument();
      expect(within(alert).queryByText('Key access error')).not.toBeInTheDocument();
    });

    it('keeps retry disabled and discard enabled when pending candidate exists in view-only', () => {
      const viewOnlyState: ViewOnlyHookState = {
        status: 'view-only',
        reason: 'STORAGE_UNAVAILABLE',
        message: 'Storage blocked',
        store: null,
      };
      const candidate = {
        candidateStore: defaultStore,
        expectedV3Token: 'tok',
        message: 'Unsaved candidate',
      };

      render(
        <HuntMemorySafetyPanel
          state={viewOnlyState}
          pendingCandidate={candidate}
          onRetry={vi.fn()}
          onDiscard={vi.fn().mockReturnValue({ status: 'success' })}
        />,
      );

      expect(screen.getByRole('button', { name: /retry save/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /discard unsaved change/i })).toBeEnabled();
    });
  });

  describe('pending candidate and stale storage isolation', () => {
    const readyState: ReadyHookState = {
      status: 'ready',
      store: defaultStore,
      v3Token: '{"schemaVersion":"3.0"}',
      cutoverRecord: freshCutoverRecord,
      legacyV2Status: 'not-applicable',
      rawV2: null,
      rawCutover: JSON.stringify(freshCutoverRecord),
    };

    it.each(['success', 'no-op', 'busy'] as const)('presents unsaved candidate and handles retry and discard %s', async (status) => {
      const user = userEvent.setup();
      const onRetry = vi.fn().mockResolvedValue({ status: 'success', store: defaultStore });
      const result: HuntMemoryDiscardResult = status === 'success'
        ? { status }
        : { status, message: 'Discard did not complete' };
      const onDiscard = vi.fn().mockReturnValueOnce({ status: 'success' }).mockReturnValue(result);

      const pendingCandidate = {
        candidateStore: defaultStore,
        expectedV3Token: '{"schemaVersion":"3.0"}',
        message: 'Write failed: storage token unchanged',
      };

      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={pendingCandidate}
          onRetry={onRetry}
          onDiscard={onDiscard}
        />,
      );

      expect(
        screen.getByRole('heading', {
          level: 3,
          name: /unsaved progress candidate \(in memory only\)/i,
        }),
      ).toBeInTheDocument();
      expect(screen.getByText(/previously verified progress active/i)).toBeInTheDocument();
      expect(screen.getByText('Unsaved change')).toBeInTheDocument();
      expect(screen.getByText(/previously verified progress was loaded in memory\. a newer mutation is held in memory and has not been saved\./i)).toBeInTheDocument();
      expect(screen.queryByText(/previously verified progress is stored in local storage/i)).not.toBeInTheDocument();
      expect(
        screen.getByText(
          /this unsaved change can be lost if this browser tab is closed or if the browser crashes/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Write failed: storage token unchanged'),
      ).not.toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /retry save/i });
      const discardBtn = screen.getByRole('button', {
        name: /discard unsaved change/i,
      });

      expect(retryBtn).toBeEnabled();
      expect(discardBtn).toBeEnabled();

      await user.click(retryBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);

      await user.click(discardBtn);
      expect(screen.getByRole('status')).toHaveTextContent('Unsaved candidate progress discarded from memory.');

      await user.click(discardBtn);
      expect(onDiscard).toHaveBeenCalledTimes(2);
      if (result.status === 'success') {
        expect(screen.getByRole('status')).toHaveTextContent('Unsaved candidate progress discarded from memory.');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      } else if (result.status === 'no-op') {
        expect(screen.getByRole('status')).toHaveTextContent('No unsaved change in memory to discard.');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole('alert')).toHaveTextContent(/discard could not proceed while an operation is in flight/i);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      }

      rerender(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={pendingCandidate}
          isBusy={true}
          onRetry={onRetry}
          onDiscard={onDiscard}
        />,
      );
      expect(screen.getByRole('button', { name: /retry save/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /discard unsaved change/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /export raw v3 progress/i })).toBeDisabled();
    });

    it('disables retry and discard when callbacks are missing', () => {
      const pendingCandidate = {
        candidateStore: defaultStore,
        expectedV3Token: '{"schemaVersion":"3.0"}',
        message: 'Write failed',
      };

      render(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={pendingCandidate}
        />,
      );

      expect(screen.getByRole('button', { name: /retry save/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /discard unsaved change/i })).toBeDisabled();
    });

    it('disables retry, keeps discard enabled, and allows raw export when storage is stale with pending candidate derived from hook state', async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      const onDiscard = vi.fn().mockReturnValue({ status: 'success' });
      const onDownload = vi.fn();

      const staleReasonText = 'STORAGE_ACCESS_ERROR: Access denied during save';
      const staleHookState: UseHuntMemoryStoreResult = {
        ...readyState,
        isBusy: false,
        isStale: true,
        canSave: false,
        staleReason: staleReasonText,
        lastError: null,
        pendingCandidate: { candidateStore: defaultStore, expectedV3Token: '{"schemaVersion":"3.0"}', message: 'Write failed' },
        mutate: vi.fn(), upgrade: vi.fn(),
        retry: vi.fn(), discard: vi.fn(),
      };

      const { rerender } = render(
        <HuntMemorySafetyPanel state={staleHookState} onRetry={onRetry} onDiscard={onDiscard} onDownload={onDownload} />,
      );

      expect(
        screen.getByText(
          /previously verified progress is held in memory, but current storage is unconfirmed\. a newer mutation is held in memory and has not been saved\./i,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/previously verified progress is stored in local storage/i)).not.toBeInTheDocument();
      expect(screen.queryByText(staleReasonText)).not.toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /retry save/i });
      expect(retryBtn).toBeDisabled();
      retryBtn.click();
      expect(onRetry).not.toHaveBeenCalled();
      expect(staleHookState.retry).not.toHaveBeenCalled();

      const discardBtn = screen.getByRole('button', { name: /discard unsaved change/i });
      expect(discardBtn).toBeEnabled();
      await user.click(discardBtn);
      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(staleHookState.discard).not.toHaveBeenCalled();

      const exportBtn = screen.getByRole('button', { name: /export raw v3 progress/i });
      expect(exportBtn).toBeEnabled();
      await user.click(exportBtn);
      expect(onDownload).toHaveBeenCalledTimes(1);
      expect(onDownload).toHaveBeenCalledWith('trophy-oracle-progress-v3.json', readyState.v3Token);

      const clearedHookState: UseHuntMemoryStoreResult = {
        ...staleHookState,
        staleReason: 'Storage cleared in another session',
        pendingCandidate: null,
      };
      rerender(
        <HuntMemorySafetyPanel state={clearedHookState} onRetry={onRetry} onDiscard={onDiscard} onDownload={onDownload} />,
      );

      expect(
        screen.getByText(
          /previously verified progress was loaded in memory, but current storage is unconfirmed\./i,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/previously verified progress is stored in local storage/i)).not.toBeInTheDocument();
      expect(screen.getByText('Storage unverified')).toBeInTheDocument();
      expect(screen.queryByText('Storage cleared in another session')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry save/i })).not.toBeInTheDocument();
      expect(
        screen.getByText(
          /retained raw schema 3\.0 progress snapshot; current storage presence is unconfirmed\./i,
        ),
      ).toBeInTheDocument();

      const clearedExportBtn = screen.getByRole('button', { name: /export raw v3 progress/i });
      expect(clearedExportBtn).toBeEnabled();
      await user.click(clearedExportBtn);
      expect(onDownload).toHaveBeenCalledTimes(2);
      expect(onDownload).toHaveBeenLastCalledWith('trophy-oracle-progress-v3.json', readyState.v3Token);
    });

    it('renders truthful unverified storage warning and reload button without external session attribution', async () => {
      const user = userEvent.setup();
      const onReload = vi.fn();

      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={readyState}
          isStale={true}
          staleReason="STORAGE_ACCESS_ERROR"
          onReload={onReload}
        />,
      );

      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(/storage unverified\. saving is blocked until reloaded/i)).toBeInTheDocument();
      expect(within(alert).getByText(/current storage cannot be verified\. saving is blocked until the application is reloaded/i)).toBeInTheDocument();
      expect(within(alert).queryByText(/another window or session/i)).not.toBeInTheDocument();
      expect(screen.getByText(/previously verified progress active/i)).toBeInTheDocument();
      expect(screen.getByText('Storage unverified')).toBeInTheDocument();

      await user.click(within(alert).getByRole('button', { name: /reload application/i }));
      expect(onReload).toHaveBeenCalledTimes(1);

      rerender(
        <HuntMemorySafetyPanel
          state={readyState}
          isStale={true}
          staleReason="STORAGE_CLEARED"
          onReload={onReload}
        />,
      );
      const clearedAlert = screen.getByRole('alert');
      expect(within(clearedAlert).getByText(/storage unverified\. saving is blocked until reloaded/i)).toBeInTheDocument();
      expect(within(clearedAlert).getByText(/current storage cannot be verified\. saving is blocked until the application is reloaded/i)).toBeInTheDocument();
      expect(within(clearedAlert).queryByText(/another window or session/i)).not.toBeInTheDocument();
      expect(within(clearedAlert).queryByText('STORAGE_CLEARED')).not.toBeInTheDocument();
    });
  });

  describe('export download failure surface', () => {
    it('surfaces error alert and does not show request notice when download throws', async () => {
      const user = userEvent.setup();
      const readyState = defaultReadyState;

      const failingDownload = vi.fn().mockImplementation(() => {
        throw new Error('URL.createObjectURL is unavailable in this environment');
      });

      render(
        <HuntMemorySafetyPanel
          state={readyState}
          onDownload={failingDownload}
        />,
      );

      const exportBtn = screen.getByRole('button', { name: /export raw v3 progress/i });
      await user.click(exportBtn);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/export request failed for trophy-oracle-progress-v3\.json/i);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('clears previous request notice when a subsequent export attempt fails', async () => {
      const user = userEvent.setup();
      const readyState = defaultReadyState;

      let shouldFail = false;
      const controlledDownload = vi.fn().mockImplementation(() => {
        if (shouldFail) {
          throw new Error('Disk quota exceeded or export failed');
        }
      });

      render(
        <HuntMemorySafetyPanel
          state={readyState}
          onDownload={controlledDownload}
        />,
      );

      const exportBtn = screen.getByRole('button', { name: /export raw v3 progress/i });

      await user.click(exportBtn);
      const statusNotice = screen.getByRole('status');
      expect(statusNotice).toHaveTextContent(/download requested for trophy-oracle-progress-v3\.json\. completion is not confirmed\./i);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      shouldFail = true;
      await user.click(exportBtn);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/export request failed for trophy-oracle-progress-v3\.json/i);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('typed action outcomes and controlled parent transitions', () => {
    it('proves controlled parent transition: confirmed state changes only when props update, not on callback resolution', async () => {
      const user = userEvent.setup();
      const readyState = defaultReadyState;

      function ControlledParent() {
        const [panelState, setPanelState] = useState<ReadyHookState | UpgradeRequiredHookState>(baseUpgradeState);
        const onUpgrade = vi.fn().mockResolvedValue({ status: 'success', store: readyState.store });
        return (
          <div>
            <HuntMemorySafetyPanel state={panelState} onUpgrade={onUpgrade} />
            <button type="button" onClick={() => setPanelState(readyState)}>
              Confirm Ready
            </button>
          </div>
        );
      }

      render(<ControlledParent />);
      const upgradeBtn = screen.getByRole('button', { name: /upgrade/i });
      await user.click(upgradeBtn);

      expect(screen.getByRole('status')).toHaveTextContent(/upgrade acknowledged/i);
      expect(screen.queryByText(/saved progress active/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /confirm ready/i }));
      expect(screen.getByText(/saved progress active/i)).toBeInTheDocument();
      expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    it('handles every typed action result variant, success, no-op, and rejection with decisive safe guidance and callback counts', async () => {
      const user = userEvent.setup();
      const readyState = defaultReadyState;
      const candidate = {
        candidateStore: defaultStore,
        expectedV3Token: 'tok',
        message: 'SECRET_MUTATION_MESSAGE',
      };

      type ResultTestCase = {
        result: HuntMemoryActionResult;
        expectedAlert?: RegExp;
        expectedNotice?: RegExp;
        secret: string;
      };

      const testVariants: readonly ResultTestCase[] = [
        {
          result: { status: 'success', store: defaultStore } satisfies HuntMemoryActionResult,
          expectedNotice: /save retry acknowledged\. waiting for confirmed storage state/i,
          secret: 'SECRET_MUTATION_MESSAGE',
        },
        {
          result: { status: 'no-op', store: defaultStore } satisfies HuntMemoryActionResult,
          expectedNotice: /no save retry was needed/i,
          secret: 'SECRET_MUTATION_MESSAGE',
        },
        {
          result: { status: 'busy', reason: 'OPERATION_IN_FLIGHT', message: 'IN_FLIGHT_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /another save operation is currently in flight/i,
          secret: 'IN_FLIGHT_SECRET',
        },
        {
          result: { status: 'busy', reason: 'UNSAVED_CANDIDATE', message: 'UNSAVED_BUSY_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /unsaved change is already pending in memory/i,
          secret: 'UNSAVED_BUSY_SECRET',
        },
        {
          result: { status: 'mutation-failed', code: 'INVALID_DOMAIN', message: 'DOMAIN_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /could not validate the requested progress change/i,
          secret: 'DOMAIN_SECRET',
        },
        {
          result: { status: 'retryable-failure', code: 'WRITE_FAILED_TOKEN_UNCHANGED', message: 'TOKEN_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /failed to write to storage, but existing saved progress is unchanged/i,
          secret: 'TOKEN_SECRET',
        },
        {
          result: { status: 'blocked', reason: 'STALE_STORAGE', message: 'STALE_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /blocked because local storage is unverified/i,
          secret: 'STALE_SECRET',
        },
        {
          result: { status: 'blocked', reason: 'STORAGE_UNAVAILABLE', message: 'STORAGE_UNAVAIL_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /blocked because local storage is unavailable in this environment/i,
          secret: 'STORAGE_UNAVAIL_SECRET',
        },
        {
          result: { status: 'recovery-required', reason: 'INVALID_V3', message: 'RECOVERY_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /stopped because storage is in an unverified state/i,
          secret: 'RECOVERY_SECRET',
        },
        {
          result: { status: 'failure', code: 'STORAGE_ACCESS_ERROR', message: 'FAILURE_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /storage access was denied or failed.*save outcome is unconfirmed/i,
          secret: 'FAILURE_SECRET',
        },
        {
          result: { status: 'failure', code: 'LOCK_ACQUISITION_REJECTED', message: 'LOCK_REJECT_SECRET' } satisfies HuntMemoryActionResult,
          expectedAlert: /storage coordination request was rejected.*save outcome is unconfirmed/i,
          secret: 'LOCK_REJECT_SECRET',
        },
      ];

      for (const variant of testVariants) {
        const onRetry = vi.fn().mockResolvedValue(variant.result);
        const { unmount } = render(
          <HuntMemorySafetyPanel
            state={readyState}
            pendingCandidate={candidate}
            onRetry={onRetry}
          />,
        );

        await user.click(screen.getByRole('button', { name: /retry save/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);

        if (variant.expectedAlert) {
          const alert = screen.getByRole('alert');
          expect(alert).toHaveTextContent(variant.expectedAlert);
          expect(alert.textContent).not.toContain(variant.secret);
          expect(screen.queryByRole('status')).not.toBeInTheDocument();
        } else if (variant.expectedNotice) {
          const notice = screen.getByRole('status');
          expect(notice).toHaveTextContent(variant.expectedNotice);
          expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        }

        expect(screen.getByRole('heading', { level: 3, name: /unsaved progress candidate/i })).toBeInTheDocument();
        unmount();
      }

      const rejectingRetry = vi.fn().mockRejectedValue(new Error('FATAL_UNCAUGHT_SECRET'));
      render(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={candidate}
          onRetry={rejectingRetry}
        />,
      );
      await user.click(screen.getByRole('button', { name: /retry save/i }));
      expect(rejectingRetry).toHaveBeenCalledTimes(1);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/save retry stopped unexpectedly and the save outcome is unconfirmed/i);
      expect(alert.textContent).not.toContain('FATAL_UNCAUGHT_SECRET');
    });

    it('never invokes callbacks on mount, focus, or rerender without explicit user click', () => {
      const onUpgrade = vi.fn();
      const onRetry = vi.fn();
      const onDiscard = vi.fn();
      const onReload = vi.fn();
      const onDownload = vi.fn();

      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={baseUpgradeState}
          onUpgrade={onUpgrade}
          onRetry={onRetry}
          onDiscard={onDiscard}
          onReload={onReload}
          onDownload={onDownload}
        />,
      );

      window.dispatchEvent(new Event('focus'));
      rerender(
        <HuntMemorySafetyPanel
          state={baseUpgradeState}
          isStale={true}
          onUpgrade={onUpgrade}
          onRetry={onRetry}
          onDiscard={onDiscard}
          onReload={onReload}
          onDownload={onDownload}
        />,
      );

      expect(onUpgrade).not.toHaveBeenCalled();
      expect(onRetry).not.toHaveBeenCalled();
      expect(onDiscard).not.toHaveBeenCalled();
      expect(onReload).not.toHaveBeenCalled();
      expect(onDownload).not.toHaveBeenCalled();
    });
  });

  describe('local admission, competing clicks, and instance isolation', () => {
    it('prevents batched duplicate and competing clicks before rerender via synchronous admission latch', async () => {
      let resolveUpgrade!: (val: HuntMemoryActionResult) => void;
      const onUpgrade = vi.fn().mockImplementation(
        () => new Promise<HuntMemoryActionResult>((resolve) => { resolveUpgrade = resolve; }),
      );
      const onDownload = vi.fn();

      render(
        <HuntMemorySafetyPanel
          state={baseUpgradeState}
          onUpgrade={onUpgrade}
          onDownload={onDownload}
        />,
      );
      const upgradeBtn = screen.getByRole('button', { name: /upgrade/i });
      const exportBtn = screen.getByRole('button', { name: /export/i });

      act(() => {
        upgradeBtn.click();
        upgradeBtn.click();
        exportBtn.click();
      });

      expect(onUpgrade).toHaveBeenCalledTimes(1);
      expect(onDownload).not.toHaveBeenCalled();

      await act(async () => {
        resolveUpgrade({ status: 'success', store: defaultStore });
      });
      expect(onDownload).not.toHaveBeenCalled();
    });

    it('table-drives retry rejection in all non-ready postures while preserving permitted discard and callback absence', () => {
      const candidate = { candidateStore: defaultStore, expectedV3Token: 'tok', message: 'Unsaved candidate' };

      const nonReadyStates: readonly HuntMemoryDiscriminatedState[] = [
        { status: 'fresh', store: defaultStore, v3Token: null },
        baseUpgradeState,
        { status: 'recovery-required', reason: 'INVALID_V3', message: 'Err', store: null },
        { status: 'view-only', reason: 'STORAGE_UNAVAILABLE', message: 'No store', store: null },
        { status: 'failure', code: 'STORAGE_ACCESS_ERROR', message: 'Fail', store: null },
      ];

      for (const nonReady of nonReadyStates) {
        const onRetry = vi.fn();
        const onDiscard = vi.fn().mockReturnValue({ status: 'success' });
        const { unmount } = render(
          <HuntMemorySafetyPanel
            state={nonReady}
            pendingCandidate={candidate}
            onRetry={onRetry}
            onDiscard={onDiscard}
          />,
        );

        const retryBtn = screen.getByRole('button', { name: /retry save/i });
        const discardBtn = screen.getByRole('button', { name: /discard unsaved change/i });

        expect(retryBtn).toBeDisabled();
        retryBtn.click();
        expect(onRetry).not.toHaveBeenCalled();

        expect(discardBtn).toBeEnabled();
        act(() => {
          discardBtn.click();
        });
        expect(onDiscard).toHaveBeenCalledTimes(1);

        unmount();
      }
    });

    it('two separate instances isolate feedback and resolve distinct DOM IDs and ARIA references', async () => {
      const user = userEvent.setup();
      const failingUpgrade = vi.fn().mockRejectedValue(new Error('Network error'));

      const { container } = render(
        <div>
          <div data-testid="panel-1">
            <HuntMemorySafetyPanel state={baseUpgradeState} onUpgrade={failingUpgrade} />
          </div>
          <div data-testid="panel-2">
            <HuntMemorySafetyPanel state={baseUpgradeState} onUpgrade={vi.fn()} />
          </div>
        </div>,
      );

      const panel1 = within(screen.getByTestId('panel-1'));
      const panel2 = within(screen.getByTestId('panel-2'));

      await user.click(panel1.getByRole('button', { name: /upgrade/i }));

      expect(panel1.getByRole('alert')).toHaveTextContent(/upgrade stopped unexpectedly/i);
      expect(panel2.queryByRole('alert')).not.toBeInTheDocument();

      const headings = container.querySelectorAll('h2');
      expect(headings).toHaveLength(2);
      expect(headings[0].id).not.toBe(headings[1].id);

      const sections = container.querySelectorAll('section');
      expect(sections[0].getAttribute('aria-labelledby')).toBe(headings[0].id);
      expect(sections[2].getAttribute('aria-labelledby')).toBe(headings[1].id);
      expect(document.getElementById(headings[0].id)).toBe(headings[0]);
      expect(document.getElementById(headings[1].id)).toBe(headings[1]);
    });
  });

  describe('context changes and late settlement isolation', () => {
    it('invalidates departed operations across A -> B -> A transitions and parent publication before resolution', async () => {
      let resolveUpgrade!: (val: HuntMemoryActionResult) => void;
      const onUpgrade = vi.fn().mockImplementation(
        () => new Promise<HuntMemoryActionResult>((resolve) => { resolveUpgrade = resolve; }),
      );

      const { rerender } = render(
        <HuntMemorySafetyPanel state={baseUpgradeState} onUpgrade={onUpgrade} />,
      );

      const btn = screen.getByRole('button', { name: /upgrade/i });
      act(() => {
        btn.click();
      });

      const recoveryState: RecoveryRequiredHookState = {
        status: 'recovery-required',
        reason: 'INVALID_V3',
        message: 'Damaged V3',
        store: null,
      };
      rerender(<HuntMemorySafetyPanel state={recoveryState} onUpgrade={onUpgrade} />);
      rerender(<HuntMemorySafetyPanel state={baseUpgradeState} onUpgrade={onUpgrade} />);

      await act(async () => {
        resolveUpgrade({ status: 'success', store: defaultStore });
      });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('suppresses old result when parent confirms publication before resolution', async () => {
      let resolveUpgrade!: (val: HuntMemoryActionResult) => void;
      const onUpgrade = vi.fn().mockImplementation(
        () => new Promise<HuntMemoryActionResult>((resolve) => { resolveUpgrade = resolve; }),
      );
      const readyState = defaultReadyState;

      const { rerender } = render(
        <HuntMemorySafetyPanel state={baseUpgradeState} onUpgrade={onUpgrade} />,
      );

      act(() => {
        screen.getByRole('button', { name: /upgrade/i }).click();
      });

      rerender(<HuntMemorySafetyPanel state={readyState} onUpgrade={onUpgrade} />);

      await act(async () => {
        resolveUpgrade({ status: 'success', store: defaultStore });
      });

      expect(screen.queryByText(/waiting for confirmed storage state/i)).not.toBeInTheDocument();
      expect(screen.getByText(/saved progress active/i)).toBeInTheDocument();
    });

    it('invalidates in-flight retry when candidate is replaced (candidate-A -> candidate-B) with identical token and message, while same-candidate clone preserves pending admission', async () => {
      const candidateA = { candidateStore: defaultStore, expectedV3Token: 'tok-same', message: 'IDENTICAL_DIAGNOSTIC' };
      const candidateB = { candidateStore: distinctStoreWithProgress, expectedV3Token: 'tok-same', message: 'IDENTICAL_DIAGNOSTIC' };

      expect(candidateA.candidateStore).not.toEqual(candidateB.candidateStore);
      expect(LocalProgressStoreV3Schema.parse(candidateB.candidateStore).lastGameId).toBe(mockGameStellarDrift.id);

      const settlements = [
        { status: 'success', store: defaultStore } satisfies HuntMemoryActionResult,
        { status: 'failure', code: 'RECORD_WRITE_ERROR', message: 'OLD_FAILURE_LEAK' } satisfies HuntMemoryActionResult,
        new Error('OLD_FATAL_REJECTION'),
      ];

      for (const settlement of settlements) {
        let settle!: () => void;
        const onRetry = vi.fn().mockImplementation(() => new Promise<HuntMemoryActionResult>((res, rej) => {
          settle = () => (settlement instanceof Error ? rej(settlement) : res(settlement));
        }));

        const { rerender, unmount } = render(
          <HuntMemorySafetyPanel state={defaultReadyState} pendingCandidate={candidateA} onRetry={onRetry} />,
        );
        act(() => { screen.getByRole('button', { name: /retry save/i }).click(); });
        expect(onRetry).toHaveBeenCalledTimes(1);

        rerender(<HuntMemorySafetyPanel state={defaultReadyState} pendingCandidate={candidateB} onRetry={onRetry} />);

        await act(async () => {
          try { settle(); } catch { /* rejection caught */ }
        });

        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        unmount();
      }

      let resolveClone!: (val: HuntMemoryActionResult) => void;
      const onCloneRetry = vi.fn().mockImplementation(() => new Promise<HuntMemoryActionResult>((res) => { resolveClone = res; }));
      const candidateCloneA = { candidateStore: defaultStore, expectedV3Token: 'tok-same', message: 'UPDATED_DIAGNOSTIC_AFTER_RETRY' };

      const { rerender: rerenderClone } = render(
        <HuntMemorySafetyPanel state={defaultReadyState} pendingCandidate={candidateA} onRetry={onCloneRetry} />,
      );
      const retryBtn = screen.getByRole('button', { name: /retry save/i });
      act(() => { retryBtn.click(); });
      expect(onCloneRetry).toHaveBeenCalledTimes(1);

      rerenderClone(<HuntMemorySafetyPanel state={defaultReadyState} pendingCandidate={candidateCloneA} onRetry={onCloneRetry} />);
      act(() => { retryBtn.click(); });
      expect(onCloneRetry).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveClone({ status: 'failure', code: 'RECORD_WRITE_ERROR', message: 'Write failed' });
      });
      expect(screen.getByRole('alert')).toHaveTextContent(/storage write operation failed/i);
    });

    it('proves external-busy toggle retains local admission latch until settlement and releases afterward', async () => {
      let rejectRetry!: (err: Error) => void;
      const onRetry = vi.fn().mockImplementation(
        () => new Promise<HuntMemoryActionResult>((_, reject) => { rejectRetry = reject; }),
      );
      const readyState = defaultReadyState;
      const candidate = { candidateStore: defaultStore, expectedV3Token: 'tok', message: 'Draft' };

      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={candidate}
          onRetry={onRetry}
        />,
      );

      const retryBtn = screen.getByRole('button', { name: /retry save/i });
      act(() => {
        retryBtn.click();
      });
      expect(onRetry).toHaveBeenCalledTimes(1);

      rerender(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={candidate}
          isBusy={true}
          onRetry={onRetry}
        />,
      );
      rerender(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={candidate}
          isBusy={false}
          onRetry={onRetry}
        />,
      );

      retryBtn.click();
      expect(onRetry).toHaveBeenCalledTimes(1);

      await act(async () => {
        rejectRetry(new Error('NETWORK_FAILURE'));
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();

      onRetry.mockResolvedValueOnce({ status: 'success', store: defaultStore });
      await act(async () => {
        retryBtn.click();
      });
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('catches thrown discard error with sanitized feedback', async () => {
      const user = userEvent.setup();
      const throwingDiscard = vi.fn().mockImplementation(() => {
        throw new Error('MEMORY_QUOTA_ERROR');
      });
      const candidate = {
        candidateStore: defaultStore,
        expectedV3Token: 'tok',
        message: 'Unsaved draft',
      };

      render(
        <HuntMemorySafetyPanel
          state={baseUpgradeState}
          pendingCandidate={candidate}
          onDiscard={throwingDiscard}
        />,
      );

      await user.click(screen.getByRole('button', { name: /discard unsaved change/i }));
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/discard failed unexpectedly\. memory state may be unchanged\./i);
      expect(alert.textContent).not.toContain('MEMORY_QUOTA_ERROR');
    });
  });

  describe('spoiler protection and safe presentation', () => {
    it('ensures raw protected strings are never leaked into DOM or accessible names', () => {
      const PROTECTED = {
        error: 'SPOILER_SECRET_DUNGEON_CHEST',
        stale: 'SPOILER_SECRET_BOSS_HP',
        candidate: 'SPOILER_ACHIEVEMENT_NAME',
        conflict: 'SPOILER_CONFLICT_PATH_D:/secret/leak',
        legacy: 'SPOILER_LEGACY_LORE',
        message: 'SPOILER_INTERNAL_EX_STACK',
      };

      const poisonedRecovery: RecoveryRequiredHookState = {
        status: 'recovery-required',
        reason: 'CUTOVER_WITHOUT_V3',
        message: PROTECTED.message,
        store: null,
        conflicts: [PROTECTED.conflict],
      };

      const poisonedCandidate = {
        candidateStore: defaultStore,
        expectedV3Token: 'tok',
        message: PROTECTED.candidate,
      };

      const { container } = render(
        <HuntMemorySafetyPanel
          state={poisonedRecovery}
          pendingCandidate={poisonedCandidate}
          isStale={true}
          staleReason={PROTECTED.stale}
          lastError={PROTECTED.error}
        />,
      );

      for (const secret of Object.values(PROTECTED)) {
        expect(container.textContent).not.toContain(secret);
        expect(container.innerHTML).not.toContain(secret);
      }

      const readyStateWithProtectedLegacy: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
        cutoverRecord: freshCutoverRecord,
        legacyV2Status: 'changed',
        legacyV2Warning: PROTECTED.legacy,
        rawV2: null,
        rawCutover: JSON.stringify(freshCutoverRecord),
      };

      const { container: readyContainer } = render(
        <HuntMemorySafetyPanel state={readyStateWithProtectedLegacy} />,
      );
      expect(readyContainer.textContent).not.toContain(PROTECTED.legacy);
      expect(readyContainer.innerHTML).not.toContain(PROTECTED.legacy);

      const unknownRecovery: RecoveryRequiredHookState = {
        status: 'recovery-required', reason: 'UNKNOWN_RECOVERY_REASON_TOKEN', message: 'Unparsed recovery error', store: null,
      };
      const { container: unknownRecoveryContainer } = render(
        <HuntMemorySafetyPanel state={unknownRecovery} />,
      );
      expect(unknownRecoveryContainer.textContent).toContain('Storage is in an unverified state.');
      expect(unknownRecoveryContainer.textContent).not.toContain('UNKNOWN_RECOVERY_REASON_TOKEN');

      const unknownFailure: FailureHookState = {
        status: 'failure', code: 'UNKNOWN_FAILURE_CODE_TOKEN', message: 'Unparsed failure error', store: null,
      };
      const { container: unknownFailureContainer } = render(
        <HuntMemorySafetyPanel state={unknownFailure} />,
      );
      expect(unknownFailureContainer.textContent).toContain('A storage error occurred.');
      expect(unknownFailureContainer.textContent).not.toContain('UNKNOWN_FAILURE_CODE_TOKEN');
    });
  });
});
