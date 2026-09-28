import type { ProgressV3CutoverRecord } from '../../data/hunt-memory-storage';
import type { HuntMemoryDiscriminatedState } from './use-hunt-memory-store';

export type RawExportId =
  | 'v2-current'
  | 'v2-cutover-backup'
  | 'v3'
  | 'cutover-record';

export interface RawExportOption {
  readonly id: RawExportId;
  readonly label: string;
  readonly filename: string;
  readonly rawBytes: string;
  readonly description: string;
}

export function defaultRawDownload(filename: string, content: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Browser environment is required to trigger download');
  }

  const createObjectURL =
    typeof window.URL?.createObjectURL === 'function'
      ? window.URL.createObjectURL.bind(window.URL)
      : null;
  const revokeObjectURL =
    typeof window.URL?.revokeObjectURL === 'function'
      ? window.URL.revokeObjectURL.bind(window.URL)
      : null;

  if (!createObjectURL) {
    throw new Error('URL.createObjectURL is unavailable in this environment');
  }

  const isJson = (() => {
    try {
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  })();
  const mimeType = isJson
    ? 'application/json;charset=utf-8'
    : 'text/plain;charset=utf-8';
  const blob = new Blob([content], { type: mimeType });

  const url = createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (typeof revokeObjectURL === 'function') {
    revokeObjectURL(url);
  }
}

export function getRawExportOptions(
  state: HuntMemoryDiscriminatedState,
): readonly RawExportOption[] {
  const exports: RawExportOption[] = [];

  let rawV2Current: string | null = null;
  if (state.status === 'upgrade-required') {
    rawV2Current = state.v2Token;
  } else if (state.status === 'ready') {
    rawV2Current = state.rawV2;
  } else if (state.status === 'recovery-required' || state.status === 'failure') {
    rawV2Current = state.rawV2 ?? null;
  } else if (state.status === 'view-only') {
    rawV2Current = state.v2Token ?? null;
  }

  let rawV2Backup: string | null = null;
  const cutoverRecord: ProgressV3CutoverRecord | null | undefined =
    state.status === 'ready' || state.status === 'recovery-required'
      ? state.cutoverRecord
      : undefined;

  if (cutoverRecord?.source === 'migrated-v2') {
    rawV2Backup = cutoverRecord.rawV2;
  }

  let rawV3: string | null = null;
  if (state.status === 'ready') {
    rawV3 = state.v3Token;
  } else if (state.status === 'view-only') {
    rawV3 = state.v3Token ?? null;
  } else if (state.status === 'recovery-required' || state.status === 'failure') {
    rawV3 = state.rawV3 ?? null;
  }

  let rawCutover: string | null = null;
  if (state.status === 'ready') {
    rawCutover = state.rawCutover;
  } else if (state.status === 'recovery-required' || state.status === 'failure') {
    rawCutover = state.rawCutover ?? null;
  }

  if (typeof rawV2Current === 'string') {
    exports.push({
      id: 'v2-current',
      label: 'Current V2 progress',
      filename: 'trophy-oracle-progress-v2-current.json',
      rawBytes: rawV2Current,
      description: 'Current raw Schema 2.0 progress stored under the live V2 key.',
    });
  }

  if (typeof rawV2Backup === 'string') {
    exports.push({
      id: 'v2-cutover-backup',
      label: 'Cutover V2 backup',
      filename: 'trophy-oracle-progress-v2-cutover-backup.json',
      rawBytes: rawV2Backup,
      description: 'Immutable original Schema 2.0 bytes preserved at cutover time.',
    });
  }

  if (typeof rawV3 === 'string') {
    exports.push({
      id: 'v3',
      label: 'Authoritative V3 progress',
      filename: 'trophy-oracle-progress-v3.json',
      rawBytes: rawV3,
      description: 'Authoritative Schema 3.0 progress stored under the active V3 key.',
    });
  }

  if (typeof rawCutover === 'string') {
    exports.push({
      id: 'cutover-record',
      label: 'Cutover record',
      filename: 'trophy-oracle-progress-v3-cutover-record.json',
      rawBytes: rawCutover,
      description: 'Immutable metadata recording Schema 3.0 initialization provenance.',
    });
  }

  return exports;
}
