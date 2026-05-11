"use client";

type AlertToastProps = {
  title: string;
  body: string;
  priority: "high" | "medium" | "low";
  onClick?: () => void;
};

function priorityTone(priority: AlertToastProps["priority"]) {
  if (priority === "high") {
    return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  }

  if (priority === "medium") {
    return "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";
  }

  return "border-white/10 bg-white/[0.03] text-slate-300";
}

export function AlertToast({ title, body, priority, onClick }: AlertToastProps) {
  const content = (
    <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-4 text-left shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{title}</p>
        <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${priorityTone(priority)}`}>
          {priority}
        </span>
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-300">{body}</p>
    </div>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      {content}
    </button>
  );
}
