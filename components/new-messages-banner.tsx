"use client";

type NewMessagesBannerProps = {
  count: number;
  sinceLabel: string | null;
  onJump: () => void;
};

export function NewMessagesBanner({ count, sinceLabel, onJump }: NewMessagesBannerProps) {
  return (
    <button
      type="button"
      onClick={onJump}
      className="sticky top-2 z-20 mx-auto flex items-center gap-2 border border-cyan-300/20 bg-slate-950/95 px-3 py-1.5 text-sm font-medium text-slate-100 backdrop-blur"
    >
      <span className="font-mono tabular-nums">{count} new</span>
      <span className="text-slate-500">{sinceLabel ? `since ${sinceLabel}` : "in channel"}</span>
    </button>
  );
}
