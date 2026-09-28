import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProgressV3CutoverRecord } from '../../data/hunt-memory-storage';
import { createDefaultHuntMemoryStore } from '../../data/hunt-memory-storage';
import type { LocalProgressStoreV3 } from '../../domain/hunt-memory-schema';
import { HuntMemorySafetyPanel } from './HuntMemorySafetyPanel';
import type {
  FailureHookState,
  FreshHookState,
  HuntMemoryDiscardResult,
  ReadyHookState,
  RecoveryRequiredHookState,
  UpgradeRequiredHookState,
  ViewOnlyHookState,
} from './use-hunt-memory-store';

const defaultStore: LocalProgressStoreV3 = createDefaultHuntMemoryStore();

const migratedCutoverRecord: ProgressV3CutoverRecord = {
  recordVersion: 1,
  source: 'migrated-v2',
  rawV2: '{"schemaVersion":"2.0","gameProgress":{},"backup":true}',
};

const freshCutoverRecord: ProgressV3CutoverRecord = {
  recordVersion: 1,
  source: 'fresh',
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
      render(
        <HuntMemorySafetyPanel
          state={freshState}
          onUpgrade={onUpgrade}
        />,
      );

      expect(
        screen.getByRole('heading', { level: 2, name: /hunt memory safety status/i }),
      ).toBeInTheDocument();
      expect(screen.getByText('State: fresh')).toBeInTheDocument();
      expect(
        screen.getByText(/fresh hunt memory \(unsaved\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /no schema 3\.0 progress is saved yet\. a progress change is saved only after storage confirms it/i,
        ),
      ).toBeInTheDocument();

      expect(
        screen.queryByRole('button', { name: /upgrade/i }),
      ).not.toBeInTheDocument();
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
        screen.getByText(/schema 2\.0 progress detected \(preview only\)/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/please close other open trophy oracle browser tabs/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/you may export your original schema 2\.0 bytes below/i),
      ).toBeInTheDocument();

      const upgradeButton = screen.getByRole('button', {
        name: /upgrade to schema 3\.0/i,
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
        name: /upgrade to schema 3\.0/i,
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
        screen.getByRole('button', { name: /upgrade to schema 3\.0/i }),
      ).toBeDisabled();
    });

    it('disables upgrade command while busy and handles error without claiming early success', async () => {
      const user = userEvent.setup();
      const onUpgrade = vi
        .fn()
        .mockResolvedValue({ status: 'blocked', message: 'Storage lock acquisition timed out' });

      const { rerender } = render(
        <HuntMemorySafetyPanel
          state={upgradeState}
          onUpgrade={onUpgrade}
        />,
      );

      const upgradeButton = screen.getByRole('button', {
        name: /upgrade to schema 3\.0/i,
      });
      await user.click(upgradeButton);

      const errorAlert = await screen.findByRole('alert');
      expect(errorAlert).toHaveTextContent(/storage lock acquisition timed out/i);
      expect(screen.queryByText(/upgraded successfully/i)).not.toBeInTheDocument();

      rerender(
        <HuntMemorySafetyPanel
          state={upgradeState}
          isBusy={true}
          onUpgrade={onUpgrade}
        />,
      );
      expect(
        screen.getByRole('button', { name: /upgrading to schema 3\.0\.\.\./i }),
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
        name: /export current v2 progress as trophy-oracle-progress-v2-current\.json/i,
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
    it('provides all 4 distinct export options when legacy V2 matches cutover backup', async () => {
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

      render(
        <HuntMemorySafetyPanel
          state={readyState}
          onDownload={onDownload}
        />,
      );

      expect(
        screen.getByText(/authoritative schema 3\.0 progress active/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/legacy v2 key matches the immutable cutover backup/i),
      ).toBeInTheDocument();

      const exportsHeading = screen.getByRole('heading', {
        level: 3,
        name: /raw storage exports \(4\)/i,
      });
      expect(exportsHeading).toBeInTheDocument();

      const v2CurrentBtn = screen.getByRole('button', {
        name: /export current v2 progress as trophy-oracle-progress-v2-current\.json/i,
      });
      const v2BackupBtn = screen.getByRole('button', {
        name: /export cutover v2 backup as trophy-oracle-progress-v2-cutover-backup\.json/i,
      });
      const v3Btn = screen.getByRole('button', {
        name: /export authoritative v3 progress as trophy-oracle-progress-v3\.json/i,
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
      ).toHaveTextContent(/legacy v2 progress has changed since cutover/i);

      const v2CurrentBtn = screen.getByRole('button', {
        name: /export current v2 progress/i,
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
        screen.getByRole('button', { name: /export authoritative v3 progress/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /export cutover record/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /cutover v2 backup/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /current v2 progress/i }),
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

      render(
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
        within(alert).getByText(/reason: cutover_without_v3 — cutover record present without v3 store/i),
      ).toBeInTheDocument();
      expect(
        within(alert).getByText('trophy-oracle.progress.v3 is missing'),
      ).toBeInTheDocument();

      const reloadBtn = within(alert).getByRole('button', { name: /reload application/i });
      await user.click(reloadBtn);
      expect(onReload).toHaveBeenCalledTimes(1);

      expect(
        screen.getByRole('button', { name: /export cutover record/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /export cutover v2 backup/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /export authoritative v3 progress/i }),
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

      const v3ExportBtn = screen.getByRole('button', {
        name: /export authoritative v3 progress/i,
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
        name: /export authoritative v3 progress/i,
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
        within(alert).getByText(/reason: lock_unavailable/i),
      ).toBeInTheDocument();

      await user.click(within(alert).getByRole('button', { name: /reload application/i }));
      expect(onReload).toHaveBeenCalledTimes(1);

      expect(
        screen.getByRole('button', { name: /export authoritative v3 progress/i }),
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
      expect(within(alert).getByText(/code: storage_access_error/i)).toBeInTheDocument();
      expect(within(alert).getByText('Key access error')).toBeInTheDocument();
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
      expect(
        screen.getByText(
          /this change is not crash-durable and will be lost if this browser tab is closed/i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Write failed: storage token unchanged'),
      ).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /retry save/i });
      const discardBtn = screen.getByRole('button', {
        name: /discard unsaved change/i,
      });

      expect(retryBtn).toBeEnabled();
      expect(discardBtn).toBeEnabled();

      await user.click(retryBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);

      await user.click(discardBtn);
      expect(screen.getByRole('status')).toHaveTextContent('Unsaved candidate progress discarded.');

      await user.click(discardBtn);
      expect(onDiscard).toHaveBeenCalledTimes(2);
      if (result.status === 'success') {
        expect(screen.getByRole('status')).toHaveTextContent('Unsaved candidate progress discarded.');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole('alert')).toHaveTextContent(result.message);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      }

      // Verify that while busy, competing actions are disabled
      rerender(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={pendingCandidate}
          isBusy={true}
          onRetry={onRetry}
          onDiscard={onDiscard}
        />,
      );
      expect(screen.getByRole('button', { name: /retrying save\.\.\./i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /discard unsaved change/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /export authoritative v3 progress/i })).toBeDisabled();
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

    it('disables retry but keeps discard enabled when storage is stale', async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      const onDiscard = vi.fn().mockReturnValue({ status: 'success' });
      const pendingCandidate = {
        candidateStore: defaultStore,
        expectedV3Token: '{"schemaVersion":"3.0"}',
        message: 'Write failed',
      };

      render(
        <HuntMemorySafetyPanel
          state={readyState}
          pendingCandidate={pendingCandidate}
          isStale={true}
          staleReason="External change detected"
          onRetry={onRetry}
          onDiscard={onDiscard}
        />,
      );

      expect(screen.getByRole('button', { name: /retry save/i })).toBeDisabled();
      const discardBtn = screen.getByRole('button', { name: /discard unsaved change/i });
      expect(discardBtn).toBeEnabled();

      await user.click(discardBtn);
      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('renders stale storage warning with reload button', async () => {
      const user = userEvent.setup();
      const onReload = vi.fn();

      render(
        <HuntMemorySafetyPanel
          state={readyState}
          isStale={true}
          staleReason="Saved progress changed in another session"
          onReload={onReload}
        />,
      );

      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(/storage modified in another session/i)).toBeInTheDocument();
      expect(within(alert).getByText('Saved progress changed in another session')).toBeInTheDocument();

      await user.click(within(alert).getByRole('button', { name: /reload application/i }));
      expect(onReload).toHaveBeenCalledTimes(1);
    });
  });

  describe('export download failure surface', () => {
    it('surfaces error alert and does not show request notice when download throws', async () => {
      const user = userEvent.setup();
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
        cutoverRecord: freshCutoverRecord,
        legacyV2Status: 'not-applicable',
        rawV2: null,
        rawCutover: JSON.stringify(freshCutoverRecord),
      };

      const failingDownload = vi.fn().mockImplementation(() => {
        throw new Error('URL.createObjectURL is unavailable in this environment');
      });

      render(
        <HuntMemorySafetyPanel
          state={readyState}
          onDownload={failingDownload}
        />,
      );

      const exportBtn = screen.getByRole('button', { name: /export authoritative v3 progress/i });
      await user.click(exportBtn);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/export failed: URL\.createObjectURL is unavailable/i);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('clears previous request notice when a subsequent export attempt fails', async () => {
      const user = userEvent.setup();
      const readyState: ReadyHookState = {
        status: 'ready',
        store: defaultStore,
        v3Token: '{"schemaVersion":"3.0"}',
        cutoverRecord: freshCutoverRecord,
        legacyV2Status: 'not-applicable',
        rawV2: null,
        rawCutover: JSON.stringify(freshCutoverRecord),
      };

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

      const exportBtn = screen.getByRole('button', { name: /export authoritative v3 progress/i });

      // First export: request returns without confirming download completion
      await user.click(exportBtn);
      const statusNotice = screen.getByRole('status');
      expect(statusNotice).toHaveTextContent(/download requested for trophy-oracle-progress-v3\.json\. completion is not confirmed\./i);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // Second export: fails, clears prior notice, and displays error alert
      shouldFail = true;
      await user.click(exportBtn);

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/export failed: disk quota exceeded or export failed/i);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
