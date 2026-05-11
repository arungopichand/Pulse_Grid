"use client";

type JumpToPresentProps = {
  count: number;
  onClick: () => void;
};

export function JumpToPresent({ count, onClick }: JumpToPresentProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-5 right-5 z-20 rounded-full border border-white/10 bg-slate-950/90 px-4 py-2 text-xs font-semibold text-white shadow-[0_16px_42px_rgba(2,6,23,0.48)] backdrop-blur transition hover:border-cyan-300/25 hover:text-cyan-100"
    >
      Jump to Present{count > 0 ? ` (${count})` : ""}
    </button>
  );
}
