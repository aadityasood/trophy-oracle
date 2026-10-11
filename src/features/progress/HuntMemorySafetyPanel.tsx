import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type {
  HuntMemoryActionResult,
  HuntMemoryDiscardResult,
  HuntMemoryDiscriminatedState,
  PendingCandidate,
  UseHuntMemoryStoreResult,
} from './use-hunt-memory-store';
import {
  defaultRawDownload,
  getRawExportOptions,
  type RawExportOption,
} from './hunt-memory-export';

export interface HuntMemorySafetyPanelProps {
  readonly state: UseHuntMemoryStoreResult | HuntMemoryDiscriminatedState;
  readonly isBusy?: boolean;
  readonly isStale?: boolean;
  readonly pendingCandidate?: PendingCandidate | null;
  readonly staleReason?: string | null;
  readonly lastError?: string | null;
  readonly onUpgrade?: () => Promise<HuntMemoryActionResult>;
  readonly onRetry?: () => Promise<HuntMemoryActionResult>;
  readonly onDiscard?: () => HuntMemoryDiscardResult;
  readonly onReload?: () => void;
  readonly onDownload?: (filename: string, content: string) => void;
}

function formatActionResultError(
  actionName: 'Upgrade' | 'Save retry',
  result: HuntMemoryActionResult,
): string {
  switch (result.status) {
    case 'busy':
      if ('reason' in result && result.reason === 'UNSAVED_CANDIDATE') {
        return `${actionName} could not proceed because an unsaved change is already pending in memory. Retry or discard that change first.`;
      }
      return `${actionName} could not start because another save operation is currently in flight. Wait for the active operation to finish and try again.`;
    case 'mutation-failed':
      return `${actionName} could not validate the requested progress change. The change was not saved. Discard the unsaved change or edit your progress.`;
    case 'retryable-failure':
      return `${actionName} failed to write to storage, but existing saved progress is unchanged. The candidate remains in memory. You may retry saving or discard the candidate.`;
    case 'blocked':
      if ('reason' in result && result.reason === 'STALE_STORAGE') {
        return `${actionName} was blocked because local storage is unverified. Reload application to inspect current saved data.`;
      }
      if ('reason' in result && result.reason === 'STORAGE_UNAVAILABLE') {
        return `${actionName} was blocked because local storage is unavailable in this environment. Progress cannot be saved.`;
      }
      return `${actionName} was prevented by storage safety restrictions. No changes were written. Reload or resolve storage status before trying again.`;
    case 'recovery-required':
      return `${actionName} stopped because storage is in an unverified state. The save outcome is unconfirmed. Check recovery status and export raw data if needed.`;
    case 'failure': {
      const detail = 'code' in result && result.code ? getFailureSafeMessage(result.code) : 'A storage error occurred.';
      return `${actionName} stopped: ${detail} The save outcome is unconfirmed. Check safety status and export raw data if needed.`;
    }
    default:
      return `${actionName} failed. The outcome could not be verified. Check safety status and export raw data if needed.`;
  }
}

function getRecoverySafeMessage(reason: string): string {
  switch (reason) {
    case 'CUTOVER_WITHOUT_V3':
      return 'At the last check, cutover metadata existed without saved progress. Storage could not be verified.';
    case 'INVALID_CUTOVER_WITHOUT_V3':
      return 'At the last check, cutover metadata was unreadable and saved progress was missing. Storage could not be verified.';
    case 'V3_WITHOUT_CUTOVER':
      return 'At the last check, saved progress existed without a cutover record. Storage provenance could not be verified.';
    case 'V3_WITH_INVALID_CUTOVER':
      return 'At the last check, cutover metadata was unreadable while saved progress existed. Storage provenance could not be verified.';
    case 'INVALID_V3':
      return 'At the last check, saved progress data was corrupted or unreadable. Existing data cannot be safely parsed.';
    case 'INTERRUPTED_WRITE_V3_UNVERIFIED':
      return 'A previous save or upgrade was interrupted before progress could be verified in storage.';
    case 'RECORD_WRITE_UNREADABLE':
      return 'Cutover metadata could not be verified after writing.';
    case 'RECORD_WRITE_DIFFERENT':
      return 'Cutover metadata in storage did not match the expected record.';
    case 'EXISTING_RECOVERY_STATE':
      return 'Storage was already in an unverified recovery state before this action.';
    case 'CUTOVER_RECORD_CHANGED_OR_UNREADABLE':
      return 'Cutover metadata was modified or became unreadable during save.';
    case 'READ_BACK_UNREADABLE':
      return 'Saved progress could not be read back from storage after writing.';
    case 'V3_STORE_MISSING_AFTER_WRITE':
      return 'Saved progress was missing from storage immediately after writing.';
    case 'V3_STORE_CONFLICT_AFTER_WRITE':
      return 'Saved progress in storage conflicted with the expected data after writing.';
    default:
      return 'Storage is in an unverified state. Automatic writes and fallbacks are disabled to protect your data.';
  }
}

function getViewOnlySafeMessage(reason: string): string {
  switch (reason) {
    case 'STORAGE_UNAVAILABLE':
      return 'Browser storage is unavailable. Progress cannot be inspected or saved.';
    case 'LOCK_UNAVAILABLE':
      return 'Storage coordination is unavailable in this browser environment. Saving is disabled to prevent data corruption.';
    default:
      return 'Saving is disabled in this environment. Progress can be viewed or exported, but cannot be saved.';
  }
}

function getFailureSafeMessage(code: string): string {
  switch (code) {
    case 'STORAGE_ACCESS_ERROR':
      return 'Storage access was denied or failed. Progress cannot be inspected or saved.';
    case 'INVALID_STORAGE_KEYS':
      return 'Storage configuration is invalid. Progress cannot be safely saved.';
    case 'INVALID_SOURCE_STORE':
      return 'Previous progress data failed validation. Progress cannot be migrated.';
    case 'TRANSFORMATION_ERROR':
      return 'Progress data could not be safely converted to the current format.';
    case 'INVALID_TARGET_STORE':
      return 'Converted progress data failed validation.';
    case 'LOCK_UNAVAILABLE':
      return 'Storage coordination is unavailable. Saving is disabled.';
    case 'LOCK_ACQUISITION_REJECTED':
      return 'Storage coordination request was rejected.';
    case 'RECORD_WRITE_ERROR':
      return 'Storage write operation failed while recording cutover metadata.';
    case 'WRITE_FAILED_TOKEN_UNCHANGED':
      return 'Storage write failed, but existing saved progress remains unchanged.';
    default:
      return 'A storage error occurred. Saving is disabled to prevent data loss.';
  }
}

function getStaleSafeMessage(): string {
  return 'Current storage cannot be verified. Saving is blocked until the application is reloaded.';
}

function getPlayerFacingStatusLabel(
  status: HuntMemoryDiscriminatedState['status'],
  isStale?: boolean,
  hasPending?: boolean,
): string {
  switch (status) {
    case 'ready':
      if (hasPending) return 'Unsaved change';
      if (isStale) return 'Storage unverified';
      return 'Saved';
    case 'fresh':
      if (isStale) return 'Storage unverified';
      return 'Unsaved';
    case 'upgrade-required': return 'Upgrade needed';
    case 'recovery-required': return 'Recovery required';
    case 'view-only': return 'View only';
    case 'failure': return 'Storage unavailable';
    default: {
      const _exhaustive: never = status;
      return String(_exhaustive);
    }
  }
}

export function HuntMemorySafetyPanel(
  props: HuntMemorySafetyPanelProps,
): ReactElement {
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const candidateId = `${panelId}-candidate`;
  const exportHeadingId = `${panelId}-exports`;

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isUpgradeInProgress, setIsUpgradeInProgress] = useState(false);
  const [isRetryInProgress, setIsRetryInProgress] = useState(false);

  const isAdmittingRef = useRef(false);
  const isMountedRef = useRef(true);
  const contextGenerationRef = useRef(0);

  const { state } = props;
  const isBusy =
    props.isBusy ?? ('isBusy' in state ? state.isBusy : false);
  const isStale =
    props.isStale ?? ('isStale' in state ? state.isStale : false);
  const staleReason =
    props.staleReason !== undefined
      ? props.staleReason
      : 'staleReason' in state
        ? state.staleReason
        : null;
  const pendingCandidate =
    props.pendingCandidate !== undefined
      ? props.pendingCandidate
      : 'pendingCandidate' in state
        ? state.pendingCandidate
        : null;

  const stateRef = useRef(state);
  const isStaleRef = useRef(isStale);

  useEffect(() => {
    stateRef.current = state;
    isStaleRef.current = isStale;
  }, [state, isStale]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const lastContextRef = useRef({
    status: state.status,
    isStale,
    staleReason,
    candidateStore: pendingCandidate?.candidateStore ?? null,
    expectedV3Token: pendingCandidate?.expectedV3Token ?? null,
    hasCandidate: Boolean(pendingCandidate),
  });

  useEffect(() => {
    const prev = lastContextRef.current;
    const currentStatus = state.status;
    const currentStale = isStale;
    const currentStaleReason = staleReason;
    const currentStore = pendingCandidate?.candidateStore ?? null;
    const currentToken = pendingCandidate?.expectedV3Token ?? null;
    const currentHasCandidate = Boolean(pendingCandidate);

    const isCandidateChanged =
      currentHasCandidate !== prev.hasCandidate ||
      (currentHasCandidate &&
        (currentStore !== prev.candidateStore || currentToken !== prev.expectedV3Token));

    if (
      currentStatus !== prev.status ||
      currentStale !== prev.isStale ||
      currentStaleReason !== prev.staleReason ||
      isCandidateChanged
    ) {
      contextGenerationRef.current++;
      setActionError(null);
      setActionNotice(null);
    }

    lastContextRef.current = {
      status: currentStatus,
      isStale: currentStale,
      staleReason: currentStaleReason,
      candidateStore: currentStore,
      expectedV3Token: currentToken,
      hasCandidate: currentHasCandidate,
    };
  }, [state.status, isStale, staleReason, pendingCandidate]);

  const isLocalActionInProgress = isUpgradeInProgress || isRetryInProgress;
  const effectiveBusy = isBusy || isLocalActionInProgress;
  const { onUpgrade, onRetry, onDiscard, onDownload, onReload } = props;

  const isNoSavingState =
    state.status === 'recovery-required' ||
    state.status === 'failure' ||
    state.status === 'view-only';

  const isUpgradeDisabled =
    effectiveBusy || isStale || state.status !== 'upgrade-required' || !onUpgrade;
  const isRetryDisabled =
    effectiveBusy || isStale || state.status !== 'ready' || !pendingCandidate || !onRetry;
  const isDiscardDisabled =
    effectiveBusy || !pendingCandidate || !onDiscard;

  const rawExports = getRawExportOptions(state);

  const handleUpgradeClick = useCallback(async () => {
    if (isAdmittingRef.current || effectiveBusy || isStale || stateRef.current.status !== 'upgrade-required' || !onUpgrade) {
      return;
    }
    isAdmittingRef.current = true;
    setActionError(null);
    setActionNotice(null);
    setIsUpgradeInProgress(true);
    const opContextGen = contextGenerationRef.current;

    try {
      const result = await onUpgrade();
      if (!isMountedRef.current || opContextGen !== contextGenerationRef.current) return;
      if (isStaleRef.current || stateRef.current.status !== 'upgrade-required') return;
      if (result.status === 'success') {
        setActionNotice('Upgrade acknowledged. Waiting for confirmed storage state.');
      } else if (result.status === 'no-op') {
        setActionNotice('No storage upgrade was needed.');
      } else {
        setActionError(formatActionResultError('Upgrade', result));
      }
    } catch {
      if (!isMountedRef.current || opContextGen !== contextGenerationRef.current) return;
      if (isStaleRef.current || stateRef.current.status !== 'upgrade-required') return;
      setActionError(
        'Upgrade stopped unexpectedly and the save outcome is unconfirmed. Check storage status and export raw data if needed.',
      );
    } finally {
      isAdmittingRef.current = false;
      if (isMountedRef.current) {
        setIsUpgradeInProgress(false);
      }
    }
  }, [effectiveBusy, isStale, onUpgrade]);

  const handleRetryClick = useCallback(async () => {
    if (isAdmittingRef.current || effectiveBusy || isStale || stateRef.current.status !== 'ready' || !pendingCandidate || !onRetry) {
      return;
    }
    isAdmittingRef.current = true;
    setActionError(null);
    setActionNotice(null);
    setIsRetryInProgress(true);
    const opContextGen = contextGenerationRef.current;

    try {
      const result = await onRetry();
      if (!isMountedRef.current || opContextGen !== contextGenerationRef.current) return;
      if (isStaleRef.current || stateRef.current.status !== 'ready') return;
      if (result.status === 'success') {
        setActionNotice('Save retry acknowledged. Waiting for confirmed storage state.');
      } else if (result.status === 'no-op') {
        setActionNotice('No save retry was needed.');
      } else {
        setActionError(formatActionResultError('Save retry', result));
      }
    } catch {
      if (!isMountedRef.current || opContextGen !== contextGenerationRef.current) return;
      if (isStaleRef.current || stateRef.current.status !== 'ready') return;
      setActionError(
        'Save retry stopped unexpectedly and the save outcome is unconfirmed. Check storage status and export raw data if needed.',
      );
    } finally {
      isAdmittingRef.current = false;
      if (isMountedRef.current) {
        setIsRetryInProgress(false);
      }
    }
  }, [effectiveBusy, isStale, pendingCandidate, onRetry]);

  const handleDiscardClick = useCallback(() => {
    if (isAdmittingRef.current || effectiveBusy || isDiscardDisabled || !onDiscard) return;
    setActionError(null);
    setActionNotice(null);
    try {
      const result = onDiscard();
      if (result.status === 'success') {
        setActionNotice('Unsaved candidate progress discarded from memory.');
      } else if (result.status === 'no-op') {
        setActionNotice('No unsaved change in memory to discard.');
      } else if (result.status === 'busy') {
        setActionError(
          'Discard could not proceed while an operation is in flight. Please wait and try again.',
        );
      }
    } catch {
      setActionError('Discard failed unexpectedly. Memory state may be unchanged.');
    }
  }, [effectiveBusy, isDiscardDisabled, onDiscard]);

  const handleExportClick = useCallback(
    (option: RawExportOption) => {
      if (isAdmittingRef.current || effectiveBusy) return;
      setActionError(null);
      setActionNotice(null);
      try {
        const downloadFn = onDownload ?? defaultRawDownload;
        downloadFn(option.filename, option.rawBytes);
        setActionNotice(
          `Download requested for ${option.filename}. Completion is not confirmed.`,
        );
      } catch {
        setActionNotice(null);
        setActionError(
          `Export request failed for ${option.filename}. Check browser download permissions.`,
        );
      }
    },
    [effectiveBusy, onDownload],
  );

  const handleReloadClick = useCallback(() => {
    if (isAdmittingRef.current || effectiveBusy || !onReload) return;
    onReload();
  }, [effectiveBusy, onReload]);

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-4 rounded-lg border border-slate-800 bg-slate-900/90 p-5 text-slate-100"
    >
      <div className="flex flex-col gap-1 border-b border-slate-800 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id={titleId} className="text-base font-bold text-slate-100">
          Hunt Memory Safety Status
        </h2>
        <span className="self-start rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300 sm:self-auto">
          {getPlayerFacingStatusLabel(state.status, isStale, Boolean(pendingCandidate))}
        </span>
      </div>

      {actionNotice && (
        <div
          role="status"
          aria-live="polite"
          className="rounded border border-emerald-800/60 bg-emerald-950/40 p-3 text-xs text-emerald-300"
        >
          {actionNotice}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded border border-red-500/50 bg-red-950/40 p-3 text-xs text-red-300"
        >
          {actionError}
        </div>
      )}

      {isStale && (
        <div
          role="alert"
          className="space-y-2 rounded border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-300"
        >
          <p className="font-semibold">
            Storage unverified. Saving is blocked until reloaded.
          </p>
          <p className="text-[11px] text-amber-200">
            {getStaleSafeMessage()}
          </p>
          {props.onReload && (
            <div className="pt-1">
              {pendingCandidate && (
                <p className="mb-2 text-[11px] text-amber-200">
                  Warning: Reloading will discard unsaved in-memory progress.
                </p>
              )}
              <button
                type="button"
                onClick={handleReloadClick}
                disabled={effectiveBusy}
                className="rounded border border-amber-700 bg-amber-900/60 px-3 py-1 font-medium text-amber-100 transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                Reload Application
              </button>
            </div>
          )}
        </div>
      )}

      {state.status === 'fresh' && (
        <div className="space-y-1 text-xs text-slate-300">
          <p className="font-semibold text-slate-200">
            {isStale ? 'Storage Status (Unconfirmed)' : 'No Saved Progress'}
          </p>
          <p>
            {isStale
              ? 'At the last check, no progress was saved to storage. Current storage is unconfirmed.'
              : 'No progress is saved to local storage yet. A progress change is saved only after storage confirms it.'}
          </p>
        </div>
      )}

      {state.status === 'upgrade-required' && (
        <div className="space-y-3 py-1 text-xs text-slate-300">
          <div>
            <p className="font-semibold text-indigo-200">
              Earlier Version Progress Detected (Preview Only)
            </p>
            <p className="mt-1">
              Existing progress was loaded and prepared in memory. Upgraded
              progress is not saved to storage until you choose to upgrade.
            </p>
          </div>
          <p className="text-slate-400">
            Please close other open Trophy Oracle browser tabs before upgrading to avoid
            storage conflicts. You may export your original data below before
            proceeding.
          </p>
          <div>
            <button
              type="button"
              onClick={handleUpgradeClick}
              disabled={isUpgradeDisabled}
              className="rounded border border-indigo-500 bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {isUpgradeInProgress ? 'Upgrading progress...' : 'Upgrade progress'}
            </button>
          </div>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="space-y-2 text-xs text-slate-300">
          <p className="font-semibold text-emerald-300">
            {pendingCandidate || isStale ? 'Previously Verified Progress Active' : 'Saved Progress Active'}
          </p>
          <p>
            {pendingCandidate
              ? isStale
                ? 'Previously verified progress is held in memory, but current storage is unconfirmed. A newer mutation is held in memory and has not been saved.'
                : 'Previously verified progress was loaded in memory. A newer mutation is held in memory and has not been saved.'
              : isStale
                ? 'Previously verified progress was loaded in memory, but current storage is unconfirmed.'
                : 'Verified progress is confirmed in local storage with cutover provenance.'}
          </p>
          {state.legacyV2Status === 'changed' && (
            <p
              role="alert"
              className="rounded border border-amber-800 bg-amber-950/40 p-2.5 text-amber-300"
            >
              {state.cutoverRecord?.source === 'fresh'
                ? 'At the last check, older Schema 2.0 data was detected after fresh initialization. Loaded progress remains active; older data is not merged automatically.'
                : 'At the last check, legacy V2 progress differed from the cutover backup. Loaded progress remains active; older V2 changes are not merged automatically.'}
            </p>
          )}
          {state.legacyV2Status === 'unavailable' && (
            <p
              role="alert"
              className="rounded border border-amber-800 bg-amber-950/40 p-2.5 text-amber-300"
            >
              Warning: Could not check older V2 progress at the last inspection.
            </p>
          )}
          {state.legacyV2Status === 'missing' && (
            <p className="text-slate-400">At the last check, the legacy V2 key was absent from storage.</p>
          )}
          {state.legacyV2Status === 'unchanged' && (
            <p className="text-slate-400">
              At the last check, the legacy V2 key matched the cutover backup.
            </p>
          )}
        </div>
      )}

      {state.status === 'recovery-required' && (
        <div
          role="alert"
          className="space-y-3 rounded border border-red-500/50 bg-red-950/30 p-4 text-xs text-red-200"
        >
          <p className="font-bold text-red-300">Recovery Required: Saving Disabled</p>
          <p>
            Saving is disabled. Storage is in an inconsistent or unverified state.
            Automatic writes, repairs, or V2 fallbacks are disabled to protect your data.
          </p>
          <p className="text-[11px] text-red-300">
            {getRecoverySafeMessage(state.reason)}
          </p>
          {props.onReload && (
            <div>
              {pendingCandidate && (
                <p className="mb-2 text-[11px] text-amber-300">
                  Warning: Reloading will discard unsaved in-memory progress.
                </p>
              )}
              <button
                type="button"
                onClick={handleReloadClick}
                disabled={effectiveBusy}
                className="rounded border border-red-700 bg-red-900/60 px-3 py-1.5 font-medium text-red-100 transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                Reload Application
              </button>
            </div>
          )}
        </div>
      )}

      {state.status === 'view-only' && (
        <div
          role="alert"
          className="space-y-3 rounded border border-amber-800/80 bg-amber-950/30 p-4 text-xs text-amber-200"
        >
          <p className="font-bold text-amber-300">View-Only Mode: Saving Disabled</p>
          <p>
            Saving is disabled. Progress changes cannot be saved to persistent storage
            in this browser environment.
          </p>
          <p className="text-[11px] text-amber-300">
            {getViewOnlySafeMessage(state.reason)}
          </p>
          {props.onReload && (
            <div>
              {pendingCandidate && (
                <p className="mb-2 text-[11px] text-amber-300">
                  Warning: Reloading will discard unsaved in-memory progress.
                </p>
              )}
              <button
                type="button"
                onClick={handleReloadClick}
                disabled={effectiveBusy}
                className="rounded border border-amber-700 bg-amber-900/60 px-3 py-1.5 font-medium text-amber-100 transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                Reload Application
              </button>
            </div>
          )}
        </div>
      )}

      {state.status === 'failure' && (
        <div
          role="alert"
          className="space-y-3 rounded border border-red-500/50 bg-red-950/30 p-4 text-xs text-red-200"
        >
          <p className="font-bold text-red-300">Storage Failure: Saving Disabled</p>
          <p>
            Saving is disabled. Trophy Oracle could not safely inspect local storage.
          </p>
          <p className="text-[11px] text-red-300">
            {getFailureSafeMessage(state.code)}
          </p>
          {props.onReload && (
            <div>
              {pendingCandidate && (
                <p className="mb-2 text-[11px] text-amber-300">
                  Warning: Reloading will discard unsaved in-memory progress.
                </p>
              )}
              <button
                type="button"
                onClick={handleReloadClick}
                disabled={effectiveBusy}
                className="rounded border border-red-700 bg-red-900/60 px-3 py-1.5 font-medium text-red-100 transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                Reload Application
              </button>
            </div>
          )}
        </div>
      )}

      {pendingCandidate && (
        <section
          aria-labelledby={candidateId}
          className="space-y-3 border-t border-slate-800/80 pt-4 text-xs text-amber-200"
        >
          <h3 id={candidateId} className="font-semibold text-amber-200">
            Unsaved Progress Candidate (In Memory Only)
          </h3>
          <p>
            The latest change is not saved to local storage and remains in memory only.
            This unsaved change can be lost if this browser tab is closed or if the browser crashes.
            Exporting stored files will not back up this unsaved change.
          </p>
          {(isStale || isNoSavingState) && (
            <p className="font-medium text-amber-300">
              Saving is disabled in this state; retry save is unavailable. You may discard this candidate from memory.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={handleRetryClick}
              disabled={isRetryDisabled}
              className="rounded border border-amber-600 bg-amber-700 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              {isRetryInProgress ? 'Retrying save...' : 'Retry save'}
            </button>
            <button
              type="button"
              onClick={handleDiscardClick}
              disabled={isDiscardDisabled}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              Discard unsaved change
            </button>
          </div>
        </section>
      )}

      <section aria-labelledby={exportHeadingId} className="space-y-3 border-t border-slate-800 pt-4">
        <h3 id={exportHeadingId} className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Raw Storage Exports ({rawExports.length})
        </h3>

        {rawExports.length === 0 ? (
          <p className="text-xs text-slate-500">
            No raw storage files are available for export in this state.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rawExports.map((opt) => (
              <div
                key={opt.id}
                className="flex flex-col justify-between gap-2 border-b border-slate-800/60 pb-3 sm:border-b-0 sm:pb-0"
              >
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">
                    {opt.label}
                  </h4>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {opt.description}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500 break-all">
                    {opt.filename}
                  </p>
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleExportClick(opt)}
                    disabled={effectiveBusy}
                    aria-label={`Export ${opt.label} as ${opt.filename}`}
                    className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  >
                    Export {opt.label}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
