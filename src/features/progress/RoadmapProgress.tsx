import type { PlatformId } from '../../domain/achievement-schema';
import { getPlatformRoadmapLabel } from '../../domain/achievement-schema';
import type { StageId, StageSummary } from '../../domain/progress-view';

export interface RoadmapProgressProps {
  platform: PlatformId;
  edition?: string;
  achievementCount: number;
  activeStage: StageId;
  stageSummaries: StageSummary[];
  onSelectActiveStage: (stage: StageId) => void;
  isReadOnly?: boolean;
}

const platformLabels: Record<PlatformId, string> = {
  playstation: 'PlayStation',
  xbox: 'Xbox',
  steam: 'Steam',
  other: 'Other',
};

export function RoadmapProgress({
  platform,
  edition,
  achievementCount,
  activeStage,
  stageSummaries,
  onSelectActiveStage,
  isReadOnly = false,
}: RoadmapProgressProps) {
  return (
    <section
      aria-labelledby="roadmap-heading"
      className="rounded-lg border border-slate-800 border-l-4 bg-slate-900 p-5 space-y-4"
      style={{ borderLeftColor: 'var(--theme-surface-glow)' }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Platform roadmap
          </div>
          <h3 id="roadmap-heading" className="text-base font-bold text-slate-100">
            {getPlatformRoadmapLabel(platform)}
          </h3>
        </div>
        <dl className="flex flex-wrap gap-4 text-xs">
          <div>
            <dt className="text-slate-400">Platform</dt>
            <dd className="font-medium text-slate-200">{platformLabels[platform]}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Edition</dt>
            <dd className="font-medium text-slate-200">{edition ?? 'Standard'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Achievements</dt>
            <dd className="font-medium text-slate-200">{achievementCount}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-400">Roadmap Stages</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stageSummaries.map((summary) => {
            const isActive = activeStage === summary.stage;
            const pct = Math.round(summary.fraction * 100);

            return (
              <button
                key={summary.stage}
                type="button"
                aria-pressed={isActive}
                aria-label={`Select ${summary.label} stage: ${summary.completedCount} of ${summary.totalCount} completed`}
                disabled={isReadOnly}
                onClick={() => onSelectActiveStage(summary.stage)}
                className={`flex flex-col items-start justify-between rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-secondary)] disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive
                    ? 'border-[var(--theme-primary)] bg-slate-800/90 shadow-[inset_0_0_0_1px_var(--theme-secondary)]'
                    : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100">{summary.label}</span>
                  {isActive && (
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">
                      Active
                    </span>
                  )}
                </div>
                <div className="mt-2 text-xs text-slate-300">
                  <span>{summary.completedCount} / {summary.totalCount} completed</span>
                  <span className="text-slate-500"> ({summary.remainingCount} remaining)</span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-400">{pct}% complete</div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
