import {
  useCallback,
  useId,
  useState,
  type ReactElement,
} from 'react';
import type {
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
  readonly onUpgrade?: () => void | Promise<unknown>;
  readonly onRetry?: () => void | Promise<unknown>;
  readonly onDiscard?: () => HuntMemoryDiscardResult;
  readonly onReload?: () => void;
  readonly onDownload?: (filename: string, content: string) => void;
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
  const [isActionInProgress, setIsActionInProgress] = useState(false);

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
  const lastError =
    props.lastError !== undefined
      ? props.lastError
      : 'lastError' in state
        ? state.lastError
        : null;
  const pendingCandidate =
    props.pendingCandidate !== undefined
      ? props.pendingCandidate
      : 'pendingCandidate' in state
        ? state.pendingCandidate
        : null;

  const effectiveBusy = isBusy || isActionInProgress;
  const { onUpgrade, onRetry, onDiscard, onDownload } = props;

  const isNoSavingState =
    state.status === 'recovery-required' ||
    state.status === 'failure' ||
    state.status === 'view-only';

  const isUpgradeDisabled =
    effectiveBusy || isStale || !onUpgrade;
  const isRetryDisabled =
    effectiveBusy || isStale || isNoSavingState || !onRetry;
  const isDiscardDisabled =
    effectiveBusy || !onDiscard;

  const rawExports = getRawExportOptions(state);

  const handleUpgradeClick = useCallback(async () => {
    if (!onUpgrade) return;
    setActionError(null);
    setActionNotice(null);
    setIsActionInProgress(true);
    try {
      const result = await onUpgrade();
      if (
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status !== 'success'
      ) {
        const msg =
          'message' in result && typeof result.message === 'string'
            ? result.message
            : `Upgrade returned status: ${String((result as { status: string }).status)}`;
        setActionError(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Upgrade failed: ${msg}`);
    } finally {
      setIsActionInProgress(false);
    }
  }, [onUpgrade]);

  const handleRetryClick = useCallback(async () => {
    if (!onRetry) return;
    setActionError(null);
    setActionNotice(null);
    setIsActionInProgress(true);
    try {
      const result = await onRetry();
      if (
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status !== 'success'
      ) {
        const msg =
          'message' in result && typeof result.message === 'string'
            ? result.message
            : 'Retry save failed';
        setActionError(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Retry save failed: ${msg}`);
    } finally {
      setIsActionInProgress(false);
    }
  }, [onRetry]);

  const handleDiscardClick = useCallback(() => {
    if (!onDiscard) return;
    setActionError(null);
    setActionNotice(null);
    const result = onDiscard();
    if (result.status === 'success') {
      setActionNotice('Unsaved candidate progress discarded.');
    } else {
      setActionError(result.message);
    }
  }, [onDiscard]);

  const handleExportClick = useCallback(
    (option: RawExportOption) => {
      setActionError(null);
      setActionNotice(null);
      try {
        const downloadFn = onDownload ?? defaultRawDownload;
        downloadFn(option.filename, option.rawBytes);
        setActionNotice(`Download requested for ${option.filename}. Completion is not confirmed.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setActionError(`Export failed: ${msg}`);
      }
    },
    [onDownload],
  );

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
          State: {state.status}
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

      {(actionError || lastError) && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded border border-red-500/50 bg-red-950/40 p-3 text-xs text-red-300"
        >
          {actionError ?? lastError}
        </div>
      )}

      {isStale && (
        <div
          role="alert"
          className="space-y-2 rounded border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-300"
        >
          <p className="font-semibold">
            Storage modified in another session. Saving is blocked until reloaded.
          </p>
          {staleReason && <p className="font-mono">{staleReason}</p>}
          {props.onReload && (
            <button
              type="button"
              onClick={props.onReload}
              disabled={effectiveBusy}
              className="rounded border border-amber-700 bg-amber-900/60 px-3 py-1 font-medium text-amber-100 transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reload Application
            </button>
          )}
        </div>
      )}

      {state.status === 'fresh' && (
        <div className="space-y-2 text-xs text-slate-300">
          <p className="font-semibold text-slate-200">Fresh Hunt Memory (Unsaved)</p>
          <p>
            No Schema 3.0 progress is saved yet. A progress change is saved only
            after storage confirms it.
          </p>
        </div>
      )}

      {state.status === 'upgrade-required' && (
        <div className="space-y-3 rounded border border-indigo-900/50 bg-indigo-950/20 p-4 text-xs text-slate-300">
          <div>
            <p className="font-semibold text-indigo-200">
              Schema 2.0 Progress Detected (Preview Only)
            </p>
            <p className="mt-1">
              Existing progress was inspected and transformed in memory. Upgraded
              Schema 3.0 progress is not saved to disk until you choose to upgrade.
            </p>
          </div>
          <p className="rounded border border-slate-800 bg-slate-950/60 p-2.5 text-slate-400">
            Please close other open Trophy Oracle browser tabs before upgrading to avoid
            storage conflicts. You may export your original Schema 2.0 bytes below before
            proceeding.
          </p>
          <div>
            <button
              type="button"
              onClick={handleUpgradeClick}
              disabled={isUpgradeDisabled}
              className="rounded border border-indigo-500 bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {effectiveBusy ? 'Upgrading to Schema 3.0...' : 'Upgrade to Schema 3.0'}
            </button>
          </div>
        </div>
      )}

      {state.status === 'ready' && (
        <div className="space-y-2 text-xs text-slate-300">
          <p className="font-semibold text-emerald-300">
            Authoritative Schema 3.0 Progress Active
          </p>
          <p>
            Verified Schema 3.0 progress is confirmed in local storage with cutover provenance.
          </p>
          {state.legacyV2Status === 'changed' && (
            <p
              role="alert"
              className="rounded border border-amber-800 bg-amber-950/40 p-2.5 text-amber-300"
            >
              {state.legacyV2Warning ??
                'Legacy V2 progress has changed since cutover. Schema 3.0 remains authoritative; older V2 changes are not merged automatically.'}
            </p>
          )}
          {state.legacyV2Status === 'unavailable' && (
            <p
              role="alert"
              className="rounded border border-amber-800 bg-amber-950/40 p-2.5 text-amber-300"
            >
              {state.legacyV2Warning ??
                'Warning: Could not check older V2 progress in storage.'}
            </p>
          )}
          {state.legacyV2Status === 'missing' && (
            <p className="text-slate-400">Legacy V2 key is absent from storage.</p>
          )}
          {state.legacyV2Status === 'unchanged' && (
            <p className="text-slate-400">
              Legacy V2 key matches the immutable cutover backup.
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
          <p className="font-mono text-[11px] text-red-400">
            Reason: {state.reason} — {state.message}
          </p>
          {state.conflicts && state.conflicts.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 font-mono text-[11px] text-red-400">
              {state.conflicts.map((conflict, i) => (
                <li key={i}>{conflict}</li>
              ))}
            </ul>
          )}
          {props.onReload && (
            <div>
              <button
                type="button"
                onClick={props.onReload}
                disabled={effectiveBusy}
                className="rounded border border-red-700 bg-red-900/60 px-3 py-1.5 font-medium text-red-100 transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
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
          <p className="font-mono text-[11px] text-amber-400">
            Reason: {state.reason} — {state.message}
          </p>
          {props.onReload && (
            <div>
              <button
                type="button"
                onClick={props.onReload}
                disabled={effectiveBusy}
                className="rounded border border-amber-700 bg-amber-900/60 px-3 py-1.5 font-medium text-amber-100 transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
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
          <p className="font-mono text-[11px] text-red-400">
            Code: {state.code} — {state.message}
          </p>
          {state.conflicts && state.conflicts.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 font-mono text-[11px] text-red-400">
              {state.conflicts.map((conflict, i) => (
                <li key={i}>{conflict}</li>
              ))}
            </ul>
          )}
          {props.onReload && (
            <div>
              <button
                type="button"
                onClick={props.onReload}
                disabled={effectiveBusy}
                className="rounded border border-red-700 bg-red-900/60 px-3 py-1.5 font-medium text-red-100 transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
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
          className="space-y-3 rounded border border-amber-600/50 bg-amber-950/30 p-4 text-xs text-amber-200"
        >
          <h3 id={candidateId} className="font-semibold text-amber-200">
            Unsaved Progress Candidate (In Memory Only)
          </h3>
          <p>
            A progress mutation failed to write to local storage and remains in memory.
            This change is not crash-durable and will be lost if this browser tab is closed.
          </p>
          <p className="font-mono text-[11px] text-amber-300">
            {pendingCandidate.message}
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
              {effectiveBusy ? 'Retrying save...' : 'Retry save'}
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
                className="flex flex-col justify-between rounded border border-slate-800 bg-slate-950 p-3"
              >
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">
                    {opt.label}
                  </h4>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {opt.description}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    {opt.filename}
                  </p>
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleExportClick(opt)}
                    disabled={effectiveBusy}
                    aria-label={`Export ${opt.label} as ${opt.filename}`}
                    className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-secondary)]"
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
