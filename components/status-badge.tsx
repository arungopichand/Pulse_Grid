type StatusBadgeProps = {
  label: string;
  tone?: "neutral" | "positive" | "live" | "warning";
};

const toneClasses = {
  neutral: "border-white/10 bg-white/5 text-slate-200",
  positive: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  live: "border-cyan-400/20 bg-cyan-400/10 text-cyan-100",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-100",
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${toneClasses[tone]}`}
    >
      {tone === "live" ? (
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300/70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-200" />
        </span>
      ) : null}
      {label}
    </span>
  );
}
