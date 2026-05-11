"use client";

import { AlertToast } from "@/components/alert-toast";

type Toast = {
  id: string;
  title: string;
  body: string;
  priority?: "high" | "medium" | "low";
  symbol?: string;
};

type ToastStackProps = {
  toasts: Toast[];
  onSelectSymbol?: (symbol: string) => void;
};

export function ToastStack({ toasts, onSelectSymbol }: ToastStackProps) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => {
        const symbol = toast.symbol;

        return (
          <div key={toast.id} className="animate-pulseIn pointer-events-auto">
            <AlertToast
              title={toast.title}
              body={toast.body}
              priority={toast.priority ?? "medium"}
              onClick={
                symbol && onSelectSymbol
                  ? () => {
                      onSelectSymbol(symbol);
                    }
                  : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}
