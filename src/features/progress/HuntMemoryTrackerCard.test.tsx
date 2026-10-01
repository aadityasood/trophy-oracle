import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import appSource from '../../App.tsx?raw';
import { AchievementRecordSchema } from '../../domain/achievement-schema';
import { AchievementProgressV3Schema, type AchievementProgressV3 } from '../../domain/hunt-memory-schema';
import { validateTrackerShape } from '../../domain/hunt-memory-tracker-shape';
import { getTrackerPresentationV3 } from '../../domain/hunt-memory-view';
import { MOCK_TIMESTAMP, MOCK_TIMESTAMP_2, mockGameStellarDrift } from '../../test/progress-fixtures';
import { HuntMemoryTrackerCard, type HuntMemoryTrackerCardProps } from './HuntMemoryTrackerCard';
import type { HuntMemoryActionResult } from './use-hunt-memory-store';

const [set0] = mockGameStellarDrift.achievementSets;
const binaryStory = AchievementRecordSchema.parse(set0.achievements.find((a) => a.id === 'sd-ps-001')!);
const binaryMissable = AchievementRecordSchema.parse(set0.achievements.find((a) => a.id === 'sd-ps-002')!);
const boundedCounter = AchievementRecordSchema.parse(set0.achievements.find((a) => a.id === 'sd-ps-004')!);
const checklistAchievement = AchievementRecordSchema.parse(set0.achievements.find((a) => a.id === 'sd-ps-005')!);
const openCounter = AchievementRecordSchema.parse(set0.achievements.find((a) => a.id === 'sd-ps-006')!);

function makeProgress(achievementId: string, extra: Partial<AchievementProgressV3> = {}): AchievementProgressV3 {
  return AchievementProgressV3Schema.parse({
    achievementId,
    completed: false,
    manualOverride: false,
    lastUpdated: MOCK_TIMESTAMP,
    provenance: 'manual',
    ...extra,
  });
}

function createCardProps(overrides: Partial<HuntMemoryTrackerCardProps> = {}): HuntMemoryTrackerCardProps {
  const success: HuntMemoryActionResult = { status: 'success', store: { schemaVersion: '3.0', gameProgress: {} } };
  return {
    achievement: binaryStory,
    sourceIndex: 0,
    progress: makeProgress(binaryStory.id),
    isPinned: false,
    gameId: 'stellar-drift',
    setId: 'stellar-drift-ps',
    runId: 'main-run',
    getTimestamp: vi.fn(() => MOCK_TIMESTAMP_2),
    onBinaryCompletionChange: vi.fn().mockResolvedValue(success),
    onCounterProgressChange: vi.fn().mockResolvedValue(success),
    onChecklistItemCompletionChange: vi.fn().mockResolvedValue(success),
    onNotesChange: vi.fn().mockResolvedValue(success),
    onCompletionOverrideChange: vi.fn().mockResolvedValue(success),
    onTogglePin: vi.fn().mockResolvedValue(success),
    ...overrides,
  };
}

describe('HuntMemoryTrackerCard', () => {
  it('masks secret details until explicit Reveal/Hide across modes and keeps reveal usable in read-only', async () => {
    const user = userEvent.setup();
    const modes = [
      {
        achievement: binaryMissable,
        sourceIndex: 1,
        progress: makeProgress(binaryMissable.id),
        secrets: [binaryMissable.name, binaryMissable.description, binaryMissable.evidence, binaryMissable.warning!],
        hint: 'Hint: Chapter 3 route choice',
      },
      {
        achievement: boundedCounter,
        sourceIndex: 2,
        progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 5 } }),
        secrets: [boundedCounter.name, boundedCounter.description, boundedCounter.evidence],
      },
      {
        achievement: checklistAchievement,
        sourceIndex: 3,
        progress: makeProgress(checklistAchievement.id, { checklistCompletion: { 'task-a': false, 'task-b': false, 'task-c': false } }),
        secrets: [
          checklistAchievement.name,
          checklistAchievement.description,
          checklistAchievement.evidence,
          ...(checklistAchievement.tracking as { mode: 'checklist'; items: Array<{ id: string; name: string }> }).items.map((i) => i.name),
        ],
        hint: 'Hint: Complete required tasks',
      },
    ];

    for (const m of modes) {
      cleanup();
      const props = createCardProps({ achievement: m.achievement, sourceIndex: m.sourceIndex, progress: m.progress, isReadOnly: true });
      const { container } = render(<HuntMemoryTrackerCard {...props} />);

      for (const secret of m.secrets) {
        expect(screen.queryAllByText(new RegExp(secret))).toHaveLength(0);
        expect(container.innerHTML).not.toContain(secret);
      }
      if (m.hint) {
        expect(screen.getByText(new RegExp(m.hint))).toBeInTheDocument();
      }

      const revealBtn = screen.getByRole('button', { name: `Reveal details for Achievement ${m.sourceIndex + 1}` });
      expect(revealBtn).not.toBeDisabled();
      await user.click(revealBtn);
      expect(props.getTimestamp).not.toHaveBeenCalled();

      for (const secret of m.secrets) {
        expect(screen.getAllByText(new RegExp(secret)).length).toBeGreaterThan(0);
      }

      for (const ctrl of [...screen.queryAllByRole('checkbox'), ...screen.queryAllByRole('button', { name: /Apply|Save|Add/ }), ...screen.queryAllByRole('spinbutton')]) {
        expect(ctrl).toBeDisabled();
        fireEvent.click(ctrl);
      }
      expect(props.onBinaryCompletionChange).not.toHaveBeenCalled();
      expect(props.onCounterProgressChange).not.toHaveBeenCalled();
      expect(props.onChecklistItemCompletionChange).not.toHaveBeenCalled();
      expect(props.onNotesChange).not.toHaveBeenCalled();

      const hideBtn = screen.getByRole('button', { name: `Hide details for ${m.achievement.name}` });
      await user.click(hideBtn);
      for (const secret of m.secrets) {
        expect(screen.queryAllByText(new RegExp(secret))).toHaveLength(0);
        expect(container.innerHTML).not.toContain(secret);
      }
    }
  });

  it('dispatches exact payloads for binary, checklist, and pin, admitting validated prototype-named item IDs', async () => {
    const user = userEvent.setup();
    const binProps = createCardProps();
    const achievementBefore = JSON.parse(JSON.stringify(binProps.achievement));
    const progressBefore = JSON.parse(JSON.stringify(binProps.progress));
    const { unmount } = render(<HuntMemoryTrackerCard {...binProps} />);

    await user.click(screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' }));
    expect(binProps.onBinaryCompletionChange).toHaveBeenCalledWith('sd-ps-001', true);
    expect(screen.getByRole('checkbox', { name: 'Mark Achievement 1 complete' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /Override completion/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pin Achievement 1' }));
    expect(binProps.onTogglePin).toHaveBeenCalledWith('sd-ps-001', true);
    expect(binProps.achievement).toEqual(achievementBefore);
    expect(binProps.progress).toEqual(progressBefore);

    unmount();
    const protoChecklist = AchievementRecordSchema.parse({
      ...checklistAchievement,
      id: 'sd-ps-proto',
      tracking: {
        mode: 'checklist',
        items: [
          { id: 'constructor', name: 'Construct Engine' },
          { id: 'toString', name: 'Format Output' },
        ],
      },
    });
    const checklistProps = createCardProps({
      achievement: protoChecklist,
      sourceIndex: 3,
      progress: makeProgress(protoChecklist.id, { checklistCompletion: { constructor: true, toString: false } }),
    });
    expect(validateTrackerShape(checklistProps.progress!, protoChecklist.tracking)).toBe(true);
    render(<HuntMemoryTrackerCard {...checklistProps} />);

    expect(screen.getByRole('checkbox', { name: 'Item 1 for Achievement 4' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Item 2 for Achievement 4' })).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 4' }));
    expect(screen.getByRole('checkbox', { name: `Construct Engine for ${protoChecklist.name}` })).toBeChecked();
    const item2 = screen.getByRole('checkbox', { name: `Format Output for ${protoChecklist.name}` });
    expect(item2).not.toBeChecked();

    await user.click(item2);
    expect(checklistProps.onChecklistItemCompletionChange).toHaveBeenCalledWith('sd-ps-proto', 'toString', true);
    expect(item2).not.toBeChecked();
  });

  it('composes real counter editor with uncertain/above-target summaries, timestamp capture, and return-from-override', async () => {
    const user = userEvent.setup();
    const props = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 10 } }),
    });
    const { rerender } = render(<HuntMemoryTrackerCard {...props} />);

    expect(screen.getByText('Progress: 10 / 48 (38 remaining, 20%)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add 5 to counter for Achievement 3' }));
    expect(props.onCounterProgressChange).toHaveBeenCalledWith('sd-ps-004', { certainty: 'exact', value: 15 });

    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });
    await user.selectOptions(select, 'unknown');
    await user.click(screen.getByRole('button', { name: 'Apply counter for Achievement 3' }));
    expect(props.getTimestamp).toHaveBeenCalledTimes(1);
    expect(props.onCounterProgressChange).toHaveBeenCalledWith('sd-ps-004', {
      certainty: 'unknown',
      observedSinceStart: 0,
      trackingStartedAt: MOCK_TIMESTAMP_2,
    });

    rerender(<HuntMemoryTrackerCard {...props} progress={makeProgress(boundedCounter.id, { counter: { certainty: 'at_least', minimum: 50 } })} />);
    expect(screen.getByText('Progress: At least 50 / 48 (at most 0 remaining, >=100%)')).toBeInTheDocument();

    rerender(<HuntMemoryTrackerCard {...props} progress={makeProgress(boundedCounter.id, { completed: true, manualOverride: true, counter: { certainty: 'exact', value: 48 } })} />);
    expect(screen.getByText('Manual completion override active')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Return Achievement 3 to tracker-derived completion' }));
    expect(props.onCompletionOverrideChange).toHaveBeenCalledWith('sd-ps-004', false);
  });

  it('handles notes empty/whitespace Save, undefined Clear, fresh prop retention, publication clearing, and unrelated isolation', async () => {
    const user = userEvent.setup();
    const props = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { notes: 'Persisted note', counter: { certainty: 'exact', value: 5 } }),
    });
    const { rerender } = render(<HuntMemoryTrackerCard {...props} />);

    const textarea = screen.getByRole('textbox', { name: 'Manual notes for Achievement 3' });
    expect(textarea).toHaveValue('Persisted note');

    await user.clear(textarea);
    rerender(<HuntMemoryTrackerCard {...props} progress={makeProgress(boundedCounter.id, { notes: 'Persisted note', counter: { certainty: 'exact', value: 6 } })} />);
    expect(textarea).toHaveValue('');
    expect(props.onNotesChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save notes for Achievement 3' }));
    expect(props.onNotesChange).toHaveBeenCalledWith('sd-ps-004', '');

    await user.clear(textarea);
    await user.type(textarea, '   ');
    await user.click(screen.getByRole('button', { name: 'Save notes for Achievement 3' }));
    expect(props.onNotesChange).toHaveBeenCalledWith('sd-ps-004', '   ');

    await user.click(screen.getByRole('button', { name: 'Clear notes for Achievement 3' }));
    expect(props.onNotesChange).toHaveBeenCalledWith('sd-ps-004', undefined);
    rerender(<HuntMemoryTrackerCard {...props} progress={makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 6 } })} />);
    expect(textarea).toHaveValue('');

    await user.type(textarea, 'New note draft');
    await user.click(screen.getByRole('button', { name: 'Pin Achievement 3' }));
    expect(props.onTogglePin).toHaveBeenCalledWith('sd-ps-004', true);
    expect(textarea).toHaveValue('New note draft');

    await user.click(screen.getByRole('button', { name: 'Add 1 to counter for Achievement 3' }));
    expect(props.onCounterProgressChange).toHaveBeenCalledWith('sd-ps-004', { certainty: 'exact', value: 7 });
    expect(textarea).toHaveValue('New note draft');

    await user.click(screen.getByRole('button', { name: 'Save notes for Achievement 3' }));
    expect(props.onNotesChange).toHaveBeenCalledWith('sd-ps-004', 'New note draft');
    rerender(<HuntMemoryTrackerCard {...props} progress={makeProgress(boundedCounter.id, { notes: 'Published note', counter: { certainty: 'exact', value: 7 } })} />);
    expect(textarea).toHaveValue('Published note');

    (props.onNotesChange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'no-op',
      store: { schemaVersion: '3.0', gameProgress: {} },
    });
    await user.clear(textarea);
    await user.type(textarea, 'No-op candidate');
    await user.click(screen.getByRole('button', { name: 'Save notes for Achievement 3' }));
    rerender(<HuntMemoryTrackerCard {...props} progress={makeProgress(boundedCounter.id, { notes: 'Published note', counter: { certainty: 'exact', value: 7 } })} />);
    expect(textarea).toHaveValue('Published note');
  });

  it('retains notes drafts and surfaces truthful feedback across all non-success statuses and promise rejection', async () => {
    const user = userEvent.setup();
    const props = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 5 } }),
    });
    render(<HuntMemoryTrackerCard {...props} />);

    const textarea = screen.getByRole('textbox', { name: 'Manual notes for Achievement 3' });
    const saveBtn = screen.getByRole('button', { name: 'Save notes for Achievement 3' });

    const failures: Array<{ result?: HuntMemoryActionResult; reject?: Error }> = [
      { result: { status: 'busy', message: 'Storage currently busy.' } },
      { result: { status: 'mutation-failed', code: 'FAILED', message: 'Mutation rejected.' } },
      { result: { status: 'retryable-failure', code: 'WRITE_FAILED_TOKEN_UNCHANGED', message: 'Write failed.' } },
      { result: { status: 'blocked', reason: 'LOCK', message: 'Web lock unavailable.' } },
      { result: { status: 'recovery-required', reason: 'RECOV', message: 'Store requires recovery.' } },
      { result: { status: 'failure', code: 'FAIL', message: 'General failure.' } },
      { reject: new Error('Network timeout.') },
    ];

    for (const f of failures) {
      if (f.reject) {
        (props.onNotesChange as ReturnType<typeof vi.fn>).mockRejectedValueOnce(f.reject);
      } else {
        (props.onNotesChange as ReturnType<typeof vi.fn>).mockResolvedValueOnce(f.result!);
      }
      await user.clear(textarea);
      await user.type(textarea, 'Unsaved draft');
      await user.click(saveBtn);
      const expected = f.reject ? f.reject.message : (f.result as { message: string }).message;
      expect(screen.getByRole('alert')).toHaveTextContent(expected);
      expect(textarea).toHaveValue('Unsaved draft');
    }

    let resolvePending!: (res: HuntMemoryActionResult) => void;
    (props.onNotesChange as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<HuntMemoryActionResult>((res) => { resolvePending = res; }),
    );
    await user.click(saveBtn);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => {
      resolvePending({ status: 'success', store: { schemaVersion: '3.0', gameProgress: {} } });
    });
    expect(saveBtn).not.toBeDisabled();
  });

  it('manages override confirmation flow, retaining dialog on failure and closing on cancel, success, and no-op', async () => {
    const user = userEvent.setup();
    const props = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 5 } }),
    });
    render(<HuntMemoryTrackerCard {...props} />);

    await user.click(screen.getByRole('button', { name: 'Override completion for Achievement 3' }));
    expect(screen.getByText('Manually mark Achievement 3 as complete?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel completion override for Achievement 3' }));
    expect(props.onCompletionOverrideChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Manually mark Achievement 3 as complete?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Override completion for Achievement 3' }));
    (props.onCompletionOverrideChange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'blocked',
      reason: 'BLOCKED',
      message: 'Override currently blocked.',
    });
    await user.click(screen.getByRole('button', { name: 'Confirm completion override for Achievement 3' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Override currently blocked.');
    expect(screen.getByText('Manually mark Achievement 3 as complete?')).toBeInTheDocument();

    (props.onCompletionOverrideChange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'no-op',
      store: { schemaVersion: '3.0', gameProgress: {} },
    });
    await user.click(screen.getByRole('button', { name: 'Confirm completion override for Achievement 3' }));
    expect(screen.queryByText('Manually mark Achievement 3 as complete?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Override completion for Achievement 3' }));
    (props.onCompletionOverrideChange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'success',
      store: { schemaVersion: '3.0', gameProgress: {} },
    });
    await user.click(screen.getByRole('button', { name: 'Confirm completion override for Achievement 3' }));
    expect(props.onCompletionOverrideChange).toHaveBeenLastCalledWith('sd-ps-004', true);
    expect(screen.queryByText('Manually mark Achievement 3 as complete?')).not.toBeInTheDocument();
  });

  it('synchronously latches shared admission and surfaces typed busy feedback in real editor when non-counter wins', async () => {
    const user = userEvent.setup();
    let resolvePin!: (res: HuntMemoryActionResult) => void;
    const pinPromise = new Promise<HuntMemoryActionResult>((res) => { resolvePin = res; });
    const props = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 10 } }),
      onTogglePin: vi.fn().mockReturnValue(pinPromise),
    });
    render(<HuntMemoryTrackerCard {...props} />);

    const numInput = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });
    await user.clear(numInput);
    await user.type(numInput, '25');
    await user.selectOptions(select, 'estimated');

    const pinBtn = screen.getByRole('button', { name: 'Pin Achievement 3' });
    const applyBtn = screen.getByRole('button', { name: 'Apply counter for Achievement 3' });
    const saveNotesBtn = screen.getByRole('button', { name: 'Save notes for Achievement 3' });

    await act(async () => {
      fireEvent.click(pinBtn);
      fireEvent.click(applyBtn);
      fireEvent.click(saveNotesBtn);
    });

    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
    expect(props.onCounterProgressChange).not.toHaveBeenCalled();
    expect(props.onNotesChange).not.toHaveBeenCalled();
    expect(props.getTimestamp).not.toHaveBeenCalled();

    expect(screen.getByRole('alert')).toHaveTextContent('An operation is already in progress.');
    expect(numInput).toHaveValue(25);
    expect(select).toHaveValue('estimated');

    await act(async () => {
      resolvePin({ status: 'success', store: { schemaVersion: '3.0', gameProgress: {} } });
    });
    expect(pinBtn).not.toBeDisabled();
    expect(numInput).toHaveValue(25);
    expect(select).toHaveValue('estimated');
  });

  it('synchronously latches shared admission when counter action wins and suppresses concurrent sibling triggers', async () => {
    let resolveCounter!: (res: HuntMemoryActionResult) => void;
    const counterPromise = new Promise<HuntMemoryActionResult>((res) => { resolveCounter = res; });
    const props = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 10 } }),
      onCounterProgressChange: vi.fn().mockReturnValue(counterPromise),
    });
    render(<HuntMemoryTrackerCard {...props} />);

    const pinBtn = screen.getByRole('button', { name: 'Pin Achievement 3' });
    const applyBtn = screen.getByRole('button', { name: 'Apply counter for Achievement 3' });
    const saveNotesBtn = screen.getByRole('button', { name: 'Save notes for Achievement 3' });

    act(() => {
      fireEvent.click(applyBtn);
      fireEvent.click(pinBtn);
      fireEvent.click(saveNotesBtn);
    });

    expect(props.onCounterProgressChange).toHaveBeenCalledTimes(1);
    expect(props.onCounterProgressChange).toHaveBeenCalledWith('sd-ps-004', { certainty: 'exact', value: 10 });
    expect(props.onTogglePin).not.toHaveBeenCalled();
    expect(props.onNotesChange).not.toHaveBeenCalled();
    expect(pinBtn).toHaveTextContent('Pin');
    expect(pinBtn).toHaveAttribute('aria-pressed', 'false');

    await act(async () => {
      resolveCounter({ status: 'success', store: { schemaVersion: '3.0', gameProgress: {} } });
    });
    expect(applyBtn).not.toBeDisabled();
  });

  it('handles temporary unavailable progress and restores drafts across undefined, mismatched ID, and incompatible shape', async () => {
    const user = userEvent.setup();
    const props = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 10 } }),
    });
    const { rerender } = render(<HuntMemoryTrackerCard {...props} />);

    const input = screen.getByRole('spinbutton', { name: 'Set counter for Achievement 3' });
    const select = screen.getByRole('combobox', { name: 'Certainty for Achievement 3' });
    await user.clear(input);
    await user.type(input, '99');
    await user.selectOptions(select, 'estimated');

    const notesTextarea = screen.getByRole('textbox', { name: 'Manual notes for Achievement 3' });
    await user.type(notesTextarea, 'Draft note to preserve');

    await user.click(screen.getByRole('button', { name: 'Override completion for Achievement 3' }));
    expect(screen.getByText('Manually mark Achievement 3 as complete?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 3' }));
    expect(screen.getByText(boundedCounter.name)).toBeInTheDocument();

    const mismatchedIdProgress = makeProgress('sd-ps-999', { counter: { certainty: 'exact', value: 5 } });
    expect(getTrackerPresentationV3(boundedCounter, mismatchedIdProgress).status).toBe('unavailable');

    const shapeMismatchProgress = makeProgress(boundedCounter.id, { checklistCompletion: {} });
    expect(validateTrackerShape(shapeMismatchProgress, boundedCounter.tracking)).toBe(false);
    expect(getTrackerPresentationV3(boundedCounter, shapeMismatchProgress).status).toBe('unavailable');

    for (const badProgress of [undefined, mismatchedIdProgress, shapeMismatchProgress]) {
      rerender(<HuntMemoryTrackerCard {...props} progress={badProgress} />);
      expect(screen.getByRole('article', { name: `Unavailable progress for ${boundedCounter.name}` })).toBeInTheDocument();
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(props.onTogglePin).not.toHaveBeenCalled();
      expect(props.onNotesChange).not.toHaveBeenCalled();
      expect(props.onCounterProgressChange).not.toHaveBeenCalled();
      expect(props.getTimestamp).not.toHaveBeenCalled();

      rerender(<HuntMemoryTrackerCard {...props} />);
      expect(screen.getByRole('spinbutton', { name: `Set counter for ${boundedCounter.name}` })).toHaveValue(99);
      expect(screen.getByRole('combobox', { name: `Certainty for ${boundedCounter.name}` })).toHaveValue('estimated');
      expect(screen.getByRole('textbox', { name: `Manual notes for ${boundedCounter.name}` })).toHaveValue('Draft note to preserve');
      expect(screen.getByText(`Manually mark ${boundedCounter.name} as complete?`)).toBeInTheDocument();
      expect(screen.getByText(boundedCounter.name)).toBeInTheDocument();
    }

    const incompleteChecklistProgress = makeProgress(checklistAchievement.id, { checklistCompletion: { 'task-a': true } });
    expect(validateTrackerShape(incompleteChecklistProgress, checklistAchievement.tracking)).toBe(false);
    expect(getTrackerPresentationV3(checklistAchievement, incompleteChecklistProgress).status).toBe('unavailable');

    const protoChecklistProgress = makeProgress(checklistAchievement.id, {
      checklistCompletion: Object.create({ 'task-a': true, 'task-b': true, 'task-c': true }),
    });
    expect(validateTrackerShape(protoChecklistProgress, checklistAchievement.tracking)).toBe(false);

    rerender(<HuntMemoryTrackerCard {...props} achievement={checklistAchievement} sourceIndex={3} progress={incompleteChecklistProgress} />);
    expect(screen.getByRole('article', { name: 'Unavailable progress for Achievement 4' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('resets local state immediately across independent identity axes and collision-sensitive tuples', async () => {
    const user = userEvent.setup();
    const baseProps = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 10 } }),
    });

    const axisCases = [
      { override: { gameId: 'stellar-drift-alt' }, expectedValue: 10 },
      { override: { setId: 'stellar-drift-ps-alt' }, expectedValue: 10 },
      { override: { runId: 'cleanup-run' }, expectedValue: 10 },
      {
        override: {
          achievement: openCounter,
          sourceIndex: 4,
          progress: makeProgress(openCounter.id, { counter: { certainty: 'exact', value: 5 } }),
        },
        expectedValue: 5,
      },
    ];

    for (const { override, expectedValue } of axisCases) {
      cleanup();
      const { rerender } = render(<HuntMemoryTrackerCard {...baseProps} />);

      await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 3' }));
      const notes = screen.getByRole('textbox', { name: `Manual notes for ${boundedCounter.name}` });
      await user.type(notes, 'Seeded note');
      await user.click(screen.getByRole('button', { name: `Override completion for ${boundedCounter.name}` }));

      const spin = screen.getByRole('spinbutton', { name: `Set counter for ${boundedCounter.name}` });
      const combo = screen.getByRole('combobox', { name: `Certainty for ${boundedCounter.name}` });
      await user.clear(spin);
      await user.type(spin, '99');
      await user.selectOptions(combo, 'estimated');

      (baseProps.onNotesChange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'mutation-failed',
        code: 'ERR',
        message: 'Action failed.',
      });
      await user.click(screen.getByRole('button', { name: `Save notes for ${boundedCounter.name}` }));
      expect(screen.getByRole('alert')).toHaveTextContent('Action failed.');

      rerender(<HuntMemoryTrackerCard {...baseProps} {...override} />);

      expect(screen.queryByText(boundedCounter.name)).not.toBeInTheDocument();
      expect(screen.queryByText(/Manually mark/)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue('');
      expect(screen.getByRole('spinbutton')).toHaveValue(expectedValue);
      expect(screen.getByRole('combobox')).toHaveValue('exact');
    }

    cleanup();
    const colProps1 = createCardProps({
      gameId: 'a-b',
      setId: 'c',
      achievement: boundedCounter,
      sourceIndex: 2,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 10 } }),
    });
    const { rerender } = render(<HuntMemoryTrackerCard {...colProps1} />);
    await user.click(screen.getByRole('button', { name: 'Reveal details for Achievement 3' }));
    await user.type(screen.getByRole('textbox', { name: `Manual notes for ${boundedCounter.name}` }), 'Collision draft');
    expect(screen.getByText(boundedCounter.name)).toBeInTheDocument();

    rerender(<HuntMemoryTrackerCard {...colProps1} gameId="a" setId="b-c" />);
    expect(screen.queryByText(boundedCounter.name)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('spinbutton')).toHaveValue(10);
  });

  it('prevents settled old-action promises from mutating subsequent identity pending or draft state', async () => {
    const user = userEvent.setup();

    for (const outcome of ['success', 'rejection'] as const) {
      let resolveOldAction!: (res: HuntMemoryActionResult) => void;
      let rejectOldAction!: (err: Error) => void;
      const oldPromise = new Promise<HuntMemoryActionResult>((res, rej) => {
        resolveOldAction = res;
        rejectOldAction = rej;
      });
      oldPromise.catch(() => {});

      cleanup();
      const props1 = createCardProps({
        gameId: 'game-1',
        achievement: boundedCounter,
        sourceIndex: 2,
        progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 10 } }),
        onNotesChange: vi.fn().mockReturnValue(oldPromise),
      });
      const { rerender } = render(<HuntMemoryTrackerCard {...props1} />);

      const notes1 = screen.getByRole('textbox', { name: 'Manual notes for Achievement 3' });
      await user.type(notes1, 'Context 1 draft');
      await user.click(screen.getByRole('button', { name: 'Save notes for Achievement 3' }));
      expect(notes1).toBeDisabled();

      let resolveNewAction!: (res: HuntMemoryActionResult) => void;
      const newPromise = new Promise<HuntMemoryActionResult>((res) => { resolveNewAction = res; });
      const props2 = createCardProps({
        gameId: 'game-2',
        achievement: boundedCounter,
        sourceIndex: 2,
        progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 10 } }),
        onNotesChange: vi.fn().mockReturnValue(newPromise),
      });
      rerender(<HuntMemoryTrackerCard {...props2} />);

      const notes2 = screen.getByRole('textbox', { name: 'Manual notes for Achievement 3' });
      expect(notes2).not.toBeDisabled();
      await user.type(notes2, 'Context 2 draft');

      const save2 = screen.getByRole('button', { name: 'Save notes for Achievement 3' });
      await user.click(save2);
      expect(notes2).toBeDisabled();

      await act(async () => {
        if (outcome === 'success') {
          resolveOldAction({ status: 'success', store: { schemaVersion: '3.0', gameProgress: {} } });
        } else {
          rejectOldAction(new Error('Old error'));
        }
      });

      expect(notes2).toHaveValue('Context 2 draft');
      expect(notes2).toBeDisabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await act(async () => {
        resolveNewAction({ status: 'success', store: { schemaVersion: '3.0', gameProgress: {} } });
      });
      expect(notes2).not.toBeDisabled();
    }
  });

  it('isolates multi-card associations and drafts, avoids passive dispatch on mount/focus/rerender, and keeps App unmounted', async () => {
    const user = userEvent.setup();
    const card1Props = createCardProps({ achievement: binaryStory, sourceIndex: 0 });
    const card2Props = createCardProps({
      achievement: boundedCounter,
      sourceIndex: 1,
      progress: makeProgress(boundedCounter.id, { counter: { certainty: 'exact', value: 5 } }),
    });
    const { rerender } = render(
      <div>
        <HuntMemoryTrackerCard {...card1Props} />
        <HuntMemoryTrackerCard {...card2Props} />
      </div>,
    );

    const notes1 = screen.getByRole('textbox', { name: 'Manual notes for Achievement 1' });
    const notes2 = screen.getByRole('textbox', { name: 'Manual notes for Achievement 2' });
    expect(notes1.getAttribute('id')).not.toEqual(notes2.getAttribute('id'));

    await user.type(notes1, 'Card 1 local draft');
    expect(notes1).toHaveValue('Card 1 local draft');
    expect(notes2).toHaveValue('');

    fireEvent.focus(notes1);
    fireEvent.focus(notes2);
    rerender(
      <div>
        <HuntMemoryTrackerCard {...card1Props} />
        <HuntMemoryTrackerCard {...card2Props} />
      </div>,
    );

    expect(card1Props.onBinaryCompletionChange).not.toHaveBeenCalled();
    expect(card2Props.onCounterProgressChange).not.toHaveBeenCalled();
    expect(card1Props.onNotesChange).not.toHaveBeenCalled();
    expect(card2Props.onNotesChange).not.toHaveBeenCalled();
    expect(card1Props.getTimestamp).not.toHaveBeenCalled();
    expect(card2Props.getTimestamp).not.toHaveBeenCalled();

    expect(appSource).not.toContain('HuntMemoryTrackerCard');
  });
});
