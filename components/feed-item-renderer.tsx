"use client";

import { FeedCardMarketMarker } from "@/components/feed-card-market-marker";
import { FeedRowFollowup } from "@/components/feed-row-followup";
import { FeedRowSignal } from "@/components/feed-row-signal";
import type { FeedItem } from "@/lib/feed/types";

type FeedItemRendererProps = {
  item: FeedItem;
  onSelectSymbol: (symbol: string) => void;
};

export function FeedItemRenderer({ item, onSelectSymbol }: FeedItemRendererProps) {
  if (item.type === "signal") {
    return <FeedRowSignal item={item} onSelectSymbol={onSelectSymbol} />;
  }

  if (item.type === "signal_followup" || item.type === "halt") {
    return <FeedRowFollowup item={item} onSelectSymbol={onSelectSymbol} />;
  }

  if (item.type === "market_marker") {
    return <FeedCardMarketMarker item={item} />;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
      {item.headline ?? item.text ?? item.type}
    </div>
  );
}
