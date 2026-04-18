"use client";

type Toast = {
  id: string;
  title: string;
  body: string;
  symbol?: string;
};

type ToastStackProps = {
  toasts: Toast[];
  onSelectSymbol?: (symbol: string) => void;
};

export function ToastStack({ toasts, onSelectSymbol }: ToastStackProps) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => {
            if (toast.symbol && onSelectSymbol) {
              onSelectSymbol(toast.symbol);
            }
          }}
          disabled={!toast.symbol || !onSelectSymbol}
          className="glass-panel animate-pulseIn pointer-events-auto border-cyan-400/15 bg-slate-950/85 p-4 text-left disabled:cursor-default"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">{toast.title}</p>
            <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-100">
              Live
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{toast.body}</p>
        </button>
      ))}
    </div>
  );
}
