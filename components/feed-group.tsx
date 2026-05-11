"use client";

import { FeedItemRenderer } from "@/components/feed-item-renderer";
import { formatMarketTimestamp } from "@/lib/feed/day-boundary";
import type { FeedItem } from "@/lib/feed/types";

export type FeedGroupModel = {
  id: string;
  timestamp: string;
  items: FeedItem[];
};

type FeedGroupProps = {
  group: FeedGroupModel;
  onSelectSymbol: (symbol: string) => void;
  showUnreadMarker?: boolean;
};

export function FeedGroup({ group, onSelectSymbol, showUnreadMarker = false }: FeedGroupProps) {
  return (
    <div className="px-0.5">
      {showUnreadMarker ? (
        <div className="mb-2 flex items-center gap-3">
          <div className="h-px flex-1 bg-cyan-300/30" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">Unread</span>
          <div className="h-px flex-1 bg-cyan-300/30" />
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-0">
        <div className="sr-only">{formatMarketTimestamp(group.timestamp)}</div>
        <div className="space-y-0.5 border-b border-white/6 pb-1.5">
          {group.items.map((item) => (
            <FeedItemRenderer key={item.id} item={item} onSelectSymbol={onSelectSymbol} />
          ))}
        </div>
      </div>
    </div>
  );
}
