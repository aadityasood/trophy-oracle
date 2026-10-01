import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import appSource from '../../App.tsx?raw';
import { AchievementRecordSchema, type AchievementRecord } from '../../domain/achievement-schema';
import { AchievementProgressV3Schema, CounterProgressSchema, type AchievementProgressV3, type CounterProgress } from '../../domain/hunt-memory-schema';
import { validateTrackerShape } from '../../domain/hunt-memory-tracker-shape';
import { getTrackerPresentationV3 } from '../../domain/hunt-memory-view';
import { mockGameStellarDrift, MOCK_TIMESTAMP, MOCK_TIMESTAMP_2 } from '../../test/progress-fixtures';
import { HuntMemoryCounterEditor, type HuntMemoryCounterEditorProps } from './HuntMemoryCounterEditor';
import type { HuntMemoryActionResult } from './use-hunt-memory-store';

const [set0] = mockGameStellarDrift.achievementSets;
const boundedAchievement = AchievementRecordSchema.parse(set0.achievements.find((a) => a.id === 'sd-ps-004')!);
const openAchievement = AchievementRecordSchema.parse(set0.achievements.find((a) => a.id === 'sd-ps-006')!);
const binaryAchievement = AchievementRecordSchema.parse(set0.achievements.find((a) => a.id === 'sd-ps-007')!);

function makeProgress(achievementId: string, counter: CounterProgress): AchievementProgressV3 {
  return AchievementProgressV3Schema.parse({
    achievementId,
    completed: false,
    manualOverride: false,
    counter: CounterProgressSchema.parse(counter),
    lastUpdated: MOCK_TIMESTAMP,
    provenance: 'manual',
  });
}

function makeEditorProps(overrides: Partial<HuntMemoryCounterEditorProps> = {}): HuntMemoryCounterEditorProps {
  return {
    achievement: boundedAchievement,
    progress: makeProgress(boundedAchievement.id, { certainty: 'exact', value: 10 }),
    displayLabel: 'Achievement 3',
    gameId: 'stellar-drift',
    setId: 'stellar-drift-ps',
    runId: 'main-run',
    getTimestamp: vi.fn(() => MOCK_TIMESTAMP_2),
    onApply: vi.fn<HuntMemoryCounterEditorProps['onApply']>().mockResolvedValue({
      status: 'success',
      store: { schemaVersion: '3.0', gameProgress: {} },
    }),
    ...overrides,
  };
}

function renderEditor(overrides: Partial<HuntMemoryCounterEditorProps> = {}) {
  const defaultProps = makeEditorProps(overrides);
  return {
    onApply: defaultProps.onApply as ReturnType<typeof vi.fn>,
    getTimestamp: defaultProps.getTimestamp as ReturnType<typeof vi.fn>,
    renderResult: render(<HuntMemoryCounterEditor {...defaultProps} />),
    defaultProps,
  };
}

describe('HuntMemoryCounterEditor', () => {
  it('renders confirmed summaries across all four modes, bounded/open, values above target, and protects secret fields', () => {
    const { renderResult, defaultProps } = renderEditor();

    expect(screen.getByText('Progress: 10 / 48 (38 remaining, 20%)')).toBeInTheDocument();

    for (const secret of [boundedAchievement.name, boundedAchievement.description, boundedAchievement.evidence, boundedAchievement.warning].filter(Boolean)) {
      expect(screen.queryByText(secret!)).not.toBeInTheDocument();
    }
    for (const btn of screen.getAllByRole('button')) {
      const label = btn.getAttribute('aria-label') ?? '';
      expect(label).toContain(defaultProps.displayLabel);
      expect(label).not.toContain(boundedAchievement.name);
    }
    expect(screen.getByRole('spinbutton', { name: `Set counter for ${defaultProps.displayLabel}` })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: `Certainty for ${defaultProps.displayLabel}` })).toBeInTheDocument();

    const cases: Array<{ progress: AchievementProgressV3; expected: string; achievement?: AchievementRecord }> = [
      { progress: makeProgress(boundedAchievement.id, { certainty: 'at_least', minimum: 15 }), expected: 'Progress: At least 15 / 48 (at most 33 remaining, >=31%)' },
      { progress: makeProgress(boundedAchievement.id, { certainty: 'estimated', estimate: 8 }), expected: 'Progress: ~8 / 48 (~40 remaining, ~16%)' },
      { progress: makeProgress(boundedAchievement.id, { certainty: 'unknown', observedSinceStart: 3, trackingStartedAt: MOCK_TIMESTAMP }), expected: `Progress: +3 tracked since ${MOCK_TIMESTAMP}` },
      { progress: makeProgress(boundedAchievement.id, { certainty: 'exact', value: 50 }), expected: 'Progress: 50 / 48 (0 remaining, 100%)' },
      { achievement: openAchievement, progress: makeProgress(openAchievement.id, { certainty: 'exact', value: 5 }), expected: 'Progress: 5 duels (open counter)' },
    ];

    for (const c of cases) {
      renderResult.rerender(<HuntMemoryCounterEditor {...defaultProps} achievement={c.achievement ?? boundedAchievement} progress={c.progress} />);
      expect(screen.getByText(c.expected)).toBeInTheDocument();
    }
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('submits exact payload for each certainty mode Apply', async () => {
    const user = userEvent.setup();
    const { onApply, getTimestamp } = renderEditor();
    const input = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const applyButton = screen.getByRole('button', { name: 'Apply counter for Achievement 3' });
    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });

    for (const { cert, val, expected } of [
      { cert: null, val: '12', expected: { certainty: 'exact' as const, value: 12 } },
      { cert: 'at_least', val: '15', expected: { certainty: 'at_least' as const, minimum: 15 } },
      { cert: 'estimated', val: '20', expected: { certainty: 'estimated' as const, estimate: 20 } },
    ]) {
      if (cert) await user.selectOptions(select, cert);
      await user.clear(input);
      await user.type(input, val);
      await user.click(applyButton);
      expect(onApply).toHaveBeenLastCalledWith('sd-ps-004', expected);
    }
    expect(getTimestamp).not.toHaveBeenCalled();

    await user.selectOptions(select, 'unknown');
    expect(input).toHaveValue(0);
    await user.click(applyButton);
    expect(getTimestamp).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenLastCalledWith('sd-ps-004', {
      certainty: 'unknown',
      observedSinceStart: 0,
      trackingStartedAt: MOCK_TIMESTAMP_2,
    });
  });

  it('handles known-mode draft-only transitions, unknown-to-known blank guard, and known-to-unknown zero draft', async () => {
    const user = userEvent.setup();
    const { onApply } = renderEditor();
    const input = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });
    const applyButton = screen.getByRole('button', { name: 'Apply counter for Achievement 3' });

    for (const opt of ['at_least', 'estimated']) {
      await user.selectOptions(select, opt);
      expect(input).toHaveValue(10);
    }
    expect(onApply).not.toHaveBeenCalled();

    await user.selectOptions(select, 'unknown');
    expect(input).toHaveValue(0);
    await user.selectOptions(select, 'exact');
    expect(input).toHaveValue(null);

    await user.click(applyButton);
    expect(screen.getByText('Enter a non-negative whole number.')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    cleanup();
    const unkEditor = renderEditor({
      runId: 'unknown-run',
      progress: makeProgress(boundedAchievement.id, { certainty: 'unknown', observedSinceStart: 7, trackingStartedAt: MOCK_TIMESTAMP }),
    });
    const unkInput = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const unkSelect = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });
    expect(unkInput).toHaveValue(7);

    await user.selectOptions(unkSelect, 'estimated');
    expect(unkInput).toHaveValue(null);
    await user.selectOptions(unkSelect, 'unknown');
    expect(unkInput).toHaveValue(7);

    await user.click(screen.getByRole('button', { name: 'Apply counter for Achievement 3' }));
    expect(unkEditor.getTimestamp).not.toHaveBeenCalled();
    expect(unkEditor.onApply).toHaveBeenLastCalledWith('sd-ps-004', {
      certainty: 'unknown',
      observedSinceStart: 7,
      trackingStartedAt: MOCK_TIMESTAMP,
    });
  });

  it('handles quick adjustments across certainty modes, clamping decrement at 0, with no target cap or draft certainty promotion', async () => {
    const user = userEvent.setup();
    const { onApply, getTimestamp, renderResult, defaultProps } = renderEditor();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Certainty for Achievement 3' }), 'estimated');
    await user.click(screen.getByRole('button', { name: 'Add 5 to counter for Achievement 3' }));
    expect(onApply).toHaveBeenLastCalledWith('sd-ps-004', { certainty: 'exact', value: 15 });

    await user.click(screen.getByRole('button', { name: 'Decrease counter for Achievement 3' }));
    expect(onApply).toHaveBeenLastCalledWith('sd-ps-004', { certainty: 'exact', value: 9 });

    renderResult.rerender(<HuntMemoryCounterEditor {...defaultProps} progress={makeProgress(boundedAchievement.id, { certainty: 'exact', value: 0 })} />);
    expect(screen.getByRole('button', { name: 'Decrease counter for Achievement 3' })).toBeDisabled();

    const dispatches = [
      { progress: makeProgress(boundedAchievement.id, { certainty: 'exact', value: 48 }), btn: 'Add 5 to counter for Achievement 3', expected: { certainty: 'exact' as const, value: 53 } },
      { progress: makeProgress(boundedAchievement.id, { certainty: 'at_least', minimum: 15 }), btn: 'Add 5 to counter for Achievement 3', expected: { certainty: 'at_least' as const, minimum: 20 } },
      { progress: makeProgress(boundedAchievement.id, { certainty: 'estimated', estimate: 8 }), btn: 'Add 5 to counter for Achievement 3', expected: { certainty: 'estimated' as const, estimate: 13 } },
      { progress: makeProgress(boundedAchievement.id, { certainty: 'unknown', observedSinceStart: 4, trackingStartedAt: MOCK_TIMESTAMP }), btn: 'Add 1 to counter for Achievement 3', expected: { certainty: 'unknown' as const, observedSinceStart: 5, trackingStartedAt: MOCK_TIMESTAMP } },
    ];
    for (const d of dispatches) {
      renderResult.rerender(<HuntMemoryCounterEditor {...defaultProps} progress={d.progress} />);
      await user.click(screen.getByRole('button', { name: d.btn }));
      expect(onApply).toHaveBeenLastCalledWith('sd-ps-004', d.expected);
    }
    expect(getTimestamp).not.toHaveBeenCalled();

    const defaultStepAchievement = AchievementRecordSchema.parse({ ...openAchievement, tracking: { mode: 'counter', unit: 'duels' } });
    renderResult.rerender(<HuntMemoryCounterEditor {...defaultProps} achievement={defaultStepAchievement} progress={makeProgress(openAchievement.id, { certainty: 'exact', value: 2 })} />);
    expect(screen.queryByRole('button', { name: 'Add 5 to counter for Achievement 3' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add 1 to counter for Achievement 3' }));
    expect(onApply).toHaveBeenLastCalledWith('sd-ps-006', { certainty: 'exact', value: 3 });
  });

  it('rejects invalid native numeric input with visible error and allows correction', async () => {
    const user = userEvent.setup();
    const { onApply } = renderEditor();
    const input = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const applyButton = screen.getByRole('button', { name: 'Apply counter for Achievement 3' });

    for (const invalid of ['', '-3', '4.2']) {
      await user.clear(input);
      if (invalid) await user.type(input, invalid);
      await user.click(applyButton);
      expect(screen.getByText('Enter a non-negative whole number.')).toBeInTheDocument();
      expect(onApply).not.toHaveBeenCalled();
    }

    fireEvent.change(input, { target: { value: 'Infinity' } });
    await user.click(applyButton);
    expect(screen.getByText('Enter a non-negative whole number.')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '14');
    expect(screen.queryByText('Enter a non-negative whole number.')).not.toBeInTheDocument();
    await user.click(applyButton);
    expect(onApply).toHaveBeenCalledWith('sd-ps-004', { certainty: 'exact', value: 14 });
  });

  it('handles throwing and invalid timestamp on newly selected unknown Apply without dispatch', async () => {
    const user = userEvent.setup();
    const { onApply, getTimestamp } = renderEditor();
    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });
    const applyButton = screen.getByRole('button', { name: 'Apply counter for Achievement 3' });

    await user.selectOptions(select, 'unknown');
    getTimestamp.mockImplementationOnce(() => { throw new Error('Clock hardware error'); });
    await user.click(applyButton);
    expect(screen.getByText('Clock hardware error')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    expect(select).toHaveValue('unknown');

    getTimestamp.mockReturnValueOnce('not-a-valid-iso-timestamp');
    await user.click(applyButton);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    expect(select).toHaveValue('unknown');
    expect(screen.getByRole('spinbutton')).toHaveValue(0);
  });

  it('preserves unapplied numeric and certainty drafts on quick and apply non-success, while parent success and no-op clear state', async () => {
    const user = userEvent.setup();
    const { onApply } = renderEditor();
    const input = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });
    const applyBtn = screen.getByRole('button', { name: 'Apply counter for Achievement 3' });

    await user.selectOptions(select, 'estimated');
    await user.clear(input);
    await user.type(input, '25');
    onApply.mockResolvedValueOnce({ status: 'busy', message: 'System busy' });
    await user.click(screen.getByRole('button', { name: 'Add 1 to counter for Achievement 3' }));
    expect(screen.getByText('System busy')).toBeInTheDocument();
    expect(input).toHaveValue(25);
    expect(select).toHaveValue('estimated');

    const nonSuccessStatuses: Array<Extract<HuntMemoryActionResult, { message: string }>> = [
      { status: 'mutation-failed', code: 'FAILED', message: 'Mutation failed' },
      { status: 'busy', message: 'System busy' },
      { status: 'retryable-failure', code: 'WRITE_FAILED_TOKEN_UNCHANGED', message: 'Write failed retryable' },
      { status: 'blocked', reason: 'BLOCKED', message: 'Action blocked' },
      { status: 'recovery-required', reason: 'RECOVERY', message: 'Recovery required' },
      { status: 'failure', code: 'FAIL', message: 'Unrecoverable failure' },
    ];
    for (const result of nonSuccessStatuses) {
      onApply.mockResolvedValueOnce(result);
      await user.click(applyBtn);
      expect(screen.getByText(result.message)).toBeInTheDocument();
      expect(input).toHaveValue(25);
    }

    onApply.mockRejectedValueOnce(new Error('Network disconnected'));
    await user.click(applyBtn);
    expect(screen.getByText('Network disconnected')).toBeInTheDocument();
    expect(input).toHaveValue(25);

    cleanup();

    const harnessProps = makeEditorProps();
    function ControlledLifecycleHarness({ actionStatus }: { actionStatus: 'success' | 'no-op' }) {
      const [progress, setProgress] = useState(makeProgress(boundedAchievement.id, { certainty: 'exact', value: 10 }));
      const [shouldFail, setShouldFail] = useState(true);
      return (
        <div>
          <button type="button" onClick={() => setProgress(makeProgress(boundedAchievement.id, { certainty: 'exact', value: 18 }))}>
            Update
          </button>
          <HuntMemoryCounterEditor
            {...harnessProps}
            progress={progress}
            onApply={async (id, counter) => {
              if (shouldFail) {
                setShouldFail(false);
                return { status: 'busy', message: 'System busy' };
              }
              if (actionStatus === 'success') setProgress(makeProgress(id, counter));
              return { status: actionStatus, store: { schemaVersion: '3.0', gameProgress: {} } };
            }}
          />
        </div>
      );
    }

    for (const actionStatus of ['success', 'no-op'] as const) {
      const harness = render(<ControlledLifecycleHarness actionStatus={actionStatus} />);
      await user.selectOptions(screen.getByRole('combobox'), 'estimated');
      await user.clear(screen.getByRole('spinbutton'));
      await user.type(screen.getByRole('spinbutton'), '40');
      await user.click(screen.getByRole('button', { name: /Apply/ }));
      expect(screen.getByRole('alert')).toHaveTextContent('System busy');
      expect(screen.getByRole('spinbutton')).toHaveValue(40);
      expect(screen.getByRole('combobox')).toHaveValue('estimated');
      await user.click(screen.getByRole('button', { name: /Apply/ }));
      const expectedSummary = actionStatus === 'success' ? 'Progress: ~40 / 48 (~8 remaining, ~83%)' : 'Progress: 10 / 48 (38 remaining, 20%)';
      expect(screen.getByText(expectedSummary)).toBeInTheDocument();
      expect(screen.getByRole('spinbutton')).toHaveValue(actionStatus === 'success' ? 40 : 10);
      expect(screen.getByRole('combobox')).toHaveValue(actionStatus === 'success' ? 'estimated' : 'exact');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Update' }));
      expect(screen.getByText('Progress: 18 / 48 (30 remaining, 37%)')).toBeInTheDocument();
      expect(screen.getByRole('spinbutton')).toHaveValue(18);
      expect(screen.getByRole('combobox')).toHaveValue('exact');
      harness.unmount();
    }
  });

  it('guards against rapid repeated actions, disables controls during flight, and blocks mutation when read-only', async () => {
    const user = userEvent.setup();
    let resolvePromise: (value: HuntMemoryActionResult) => void;
    const deferredPromise = new Promise<HuntMemoryActionResult>((res) => { resolvePromise = res; });
    const { onApply, getTimestamp } = renderEditor();
    onApply.mockReturnValueOnce(deferredPromise);

    const applyButton = screen.getByRole('button', { name: 'Apply counter for Achievement 3' });
    const add1 = screen.getByRole('button', { name: 'Add 1 to counter for Achievement 3' });
    const input = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });

    input.focus();
    expect(getTimestamp).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(applyButton);
      fireEvent.click(add1);
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(applyButton).toBeDisabled();
    expect(add1).toBeDisabled();
    expect(input).toBeDisabled();
    expect(select).toBeDisabled();

    await user.click(applyButton);
    expect(onApply).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePromise!({ status: 'no-op', store: { schemaVersion: '3.0', gameProgress: {} } });
    });
    expect(applyButton).not.toBeDisabled();

    cleanup();
    const ro = renderEditor({ isReadOnly: true });
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    for (const name of ['Apply counter for Achievement 3', 'Add 1 to counter for Achievement 3', 'Decrease counter for Achievement 3']) {
      const btn = screen.getByRole('button', { name });
      expect(btn).toBeDisabled();
      await user.click(btn);
    }
    expect(ro.onApply).not.toHaveBeenCalled();
    expect(ro.getTimestamp).not.toHaveBeenCalled();
  });

  it('preserves drafts across same-context updates, and across temporary missing, mismatched, or incompatible progress', async () => {
    const user = userEvent.setup();
    const { onApply, getTimestamp, renderResult, defaultProps } = renderEditor();
    const input = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });

    await user.selectOptions(select, 'estimated');
    await user.clear(input);
    await user.type(input, '99');

    renderResult.rerender(<HuntMemoryCounterEditor {...defaultProps} progress={makeProgress(boundedAchievement.id, { certainty: 'exact', value: 10 })} />);
    expect(input).toHaveValue(99);

    const defensiveInvalidProgress = {
      achievementId: boundedAchievement.id,
      completed: false,
      manualOverride: false,
      lastUpdated: MOCK_TIMESTAMP,
      provenance: 'manual' as const,
    } as unknown as AchievementProgressV3;
    expect(validateTrackerShape(defensiveInvalidProgress, boundedAchievement.tracking)).toBe(false);
    expect(getTrackerPresentationV3(boundedAchievement, defensiveInvalidProgress).status).toBe('unavailable');

    const mismatchedProgress = makeProgress(openAchievement.id, { certainty: 'exact', value: 5 });
    expect(AchievementProgressV3Schema.safeParse(mismatchedProgress).success).toBe(true);
    expect(getTrackerPresentationV3(boundedAchievement, mismatchedProgress).status).toBe('unavailable');

    for (const progress of [undefined, mismatchedProgress, defensiveInvalidProgress]) {
      renderResult.rerender(<HuntMemoryCounterEditor {...defaultProps} progress={progress} />);
      expect(screen.getByRole('article', { name: `Unavailable progress for ${defaultProps.displayLabel}` })).toBeInTheDocument();
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(onApply).not.toHaveBeenCalled();
      expect(getTimestamp).not.toHaveBeenCalled();

      renderResult.rerender(<HuntMemoryCounterEditor {...defaultProps} progress={makeProgress(boundedAchievement.id, { certainty: 'exact', value: 10 })} />);
      expect(screen.getByRole('spinbutton')).toHaveValue(99);
      expect(screen.getByRole('combobox')).toHaveValue('estimated');
    }

    cleanup();
    const binaryProgress = AchievementProgressV3Schema.parse({
      achievementId: binaryAchievement.id,
      completed: false,
      manualOverride: false,
      lastUpdated: MOCK_TIMESTAMP,
      provenance: 'manual',
    });
    expect(getTrackerPresentationV3(binaryAchievement, binaryProgress).mode).toBe('binary');
    const bin = renderEditor({ achievement: binaryAchievement, progress: binaryProgress });
    expect(screen.getByRole('article', { name: `Unavailable progress for ${defaultProps.displayLabel}` })).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(bin.onApply).not.toHaveBeenCalled();
  });

  it('resets draft and error on independent tuple identity changes and isolates deferred actions', async () => {
    const user = userEvent.setup();
    const baseProps = makeEditorProps({
      gameId: 'game-a',
      setId: 'set-b',
      runId: 'run-c',
    });

    const independentIdentityChanges = [
      { patch: { gameId: 'game-a-set', setId: 'b' }, expected: 10 },
      { patch: { gameId: 'game-a-2' }, expected: 10 },
      { patch: { setId: 'set-b-2' }, expected: 10 },
      { patch: { runId: 'run-c-2' }, expected: 10 },
      { patch: { achievement: openAchievement, progress: makeProgress(openAchievement.id, { certainty: 'exact', value: 5 }) }, expected: 5 },
    ];

    const renderResult = render(<HuntMemoryCounterEditor {...baseProps} />);

    for (const c of independentIdentityChanges) {
      const input = screen.getByRole('spinbutton');
      await user.selectOptions(screen.getByRole('combobox'), 'estimated');
      await user.clear(input);
      await user.type(input, '-5');
      await user.click(screen.getByRole('button', { name: /Apply/ }));
      expect(screen.getByText('Enter a non-negative whole number.')).toBeInTheDocument();

      renderResult.rerender(<HuntMemoryCounterEditor {...baseProps} {...c.patch} />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('spinbutton')).toHaveValue(c.expected);
      expect(screen.getByRole('combobox')).toHaveValue('exact');
      expect(screen.getByRole('button', { name: /Apply/ })).not.toBeDisabled();

      renderResult.rerender(<HuntMemoryCounterEditor {...baseProps} />);
    }

    let resolveOldCallback: (value: HuntMemoryActionResult) => void;
    const oldPromise = new Promise<HuntMemoryActionResult>((res) => { resolveOldCallback = res; });
    const deferredProps = makeEditorProps({
      gameId: 'game-a',
      setId: 'set-b',
      runId: 'run-c',
      onApply: vi.fn().mockReturnValue(oldPromise),
    });

    renderResult.rerender(<HuntMemoryCounterEditor {...deferredProps} />);
    const dInput = screen.getByRole('spinbutton');
    await user.clear(dInput);
    await user.type(dInput, '77');
    await user.click(screen.getByRole('button', { name: /Apply/ }));
    expect(deferredProps.onApply).toHaveBeenCalledTimes(1);

    renderResult.rerender(<HuntMemoryCounterEditor {...deferredProps} runId="run-c-2" />);
    const newInput = screen.getByRole('spinbutton');
    const newSelect = screen.getByRole('combobox');
    expect(screen.getByRole('button', { name: /Apply/ })).not.toBeDisabled();
    expect(newInput).toHaveValue(10);

    await user.selectOptions(newSelect, 'estimated');
    await user.clear(newInput);
    await user.type(newInput, '88');

    await act(async () => {
      resolveOldCallback!({ status: 'success', store: { schemaVersion: '3.0', gameProgress: {} } });
    });

    expect(newInput).toHaveValue(88);
    expect(newSelect).toHaveValue('estimated');
    expect(screen.getByRole('button', { name: /Apply/ })).not.toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ensures multiple editors have unique DOM IDs and labels, inputs remain immutable, and App has no import', async () => {
    const user = userEvent.setup();
    const propsOne = makeEditorProps({ displayLabel: 'Editor One' });
    const propsTwo = makeEditorProps({ displayLabel: 'Editor Two' });
    const originalAchievement = structuredClone(boundedAchievement);
    const originalProgress = structuredClone(propsOne.progress!);

    render(
      <div>
        <HuntMemoryCounterEditor {...propsOne} />
        <HuntMemoryCounterEditor {...propsTwo} />
      </div>,
    );

    const input1 = screen.getByRole('spinbutton', { name: 'Set counter for Editor One' });
    const input2 = screen.getByRole('spinbutton', { name: 'Set counter for Editor Two' });
    expect(input1.id).not.toEqual(input2.id);

    const select1 = screen.getByRole('combobox', { name: 'Certainty for Editor One' });
    const select2 = screen.getByRole('combobox', { name: 'Certainty for Editor Two' });
    expect(select1.id).not.toEqual(select2.id);

    await user.type(input1, '5');
    await user.click(screen.getByRole('button', { name: 'Apply counter for Editor One' }));

    expect(boundedAchievement).toEqual(originalAchievement);
    expect(propsOne.progress).toEqual(originalProgress);
    expect(appSource).not.toContain('HuntMemoryCounterEditor');
  });
});
