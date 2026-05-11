"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FeedGroup, type FeedGroupModel } from "@/components/feed-group";
import { JumpToPresent } from "@/components/jump-to-present";
import { NewMessagesBanner } from "@/components/new-messages-banner";
import { formatMarketTimestamp, isSameMarketMinute } from "@/lib/feed/day-boundary";
import type { FeedItem } from "@/lib/feed/types";

type ChannelFeedProps = {
  items: FeedItem[];
  onSelectSymbol: (symbol: string) => void;
};

function isCompactType(type: FeedItem["type"]) {
  return type === "signal" || type === "signal_followup" || type === "filing" || type === "halt";
}

function buildGroups(items: FeedItem[]): FeedGroupModel[] {
  const groups: FeedGroupModel[] = [];

  for (const item of items) {
    const previous = groups[groups.length - 1];
    const canJoinPrevious = previous
      && previous.items.every((current) => isCompactType(current.type))
      && isCompactType(item.type)
      && isSameMarketMinute(previous.timestamp, item.timestamp);

    if (canJoinPrevious) {
      previous.items.push(item);
      continue;
    }

    groups.push({
      id: `group-${item.id}`,
      timestamp: item.timestamp,
      items: [item],
    });
  }

  return groups;
}

export function ChannelFeed({ items, onSelectSymbol }: ChannelFeedProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [firstUnreadGroupId, setFirstUnreadGroupId] = useState<string | null>(null);
  const previousLastGroupIdRef = useRef<string | null>(null);
  const [isNearPresent, setIsNearPresent] = useState(true);

  const groups = useMemo(() => buildGroups(items), [items]);

  useEffect(() => {
    const lastGroupId = groups[groups.length - 1]?.id ?? null;
    const previousLastGroupId = previousLastGroupIdRef.current;
    const hasNewTail = Boolean(lastGroupId && previousLastGroupId && lastGroupId !== previousLastGroupId);

    if (isNearPresent) {
      requestAnimationFrame(() => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth",
        });
      });
      setUnreadCount(0);
      setFirstUnreadGroupId(null);
    } else if (hasNewTail) {
      const nextUnread = groups.find((group) => {
        const previousIndex = groups.findIndex((entry) => entry.id === previousLastGroupId);
        const groupIndex = groups.findIndex((entry) => entry.id === group.id);
        return previousIndex >= 0 && groupIndex > previousIndex;
      });

      setUnreadCount((current) => current + 1);
      setFirstUnreadGroupId((current) => current ?? nextUnread?.id ?? lastGroupId);
    }

    previousLastGroupIdRef.current = lastGroupId;
  }, [groups, isNearPresent]);

  useEffect(() => {
    const handleWindowScroll = () => {
      const doc = document.documentElement;
      const distanceFromBottom = doc.scrollHeight - window.innerHeight - window.scrollY;
      const nextNearPresent = distanceFromBottom < 160;
      setIsNearPresent(nextNearPresent);

      if (nextNearPresent) {
        setUnreadCount(0);
        setFirstUnreadGroupId(null);
      }
    };

    handleWindowScroll();
    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    window.addEventListener("resize", handleWindowScroll);

    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
      window.removeEventListener("resize", handleWindowScroll);
    };
  }, []);

  const unreadSinceLabel = useMemo(() => {
    const unreadGroup = firstUnreadGroupId ? groups.find((group) => group.id === firstUnreadGroupId) ?? null : null;
    return unreadGroup ? formatMarketTimestamp(unreadGroup.timestamp) : null;
  }, [firstUnreadGroupId, groups]);

  function scrollToBottom() {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "smooth",
    });
    setIsNearPresent(true);
    setUnreadCount(0);
    setFirstUnreadGroupId(null);
  }

  return (
    <section className="relative">
      <div className="flex items-center justify-between px-0.5 pb-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Live Feed</p>
        <span className="font-mono text-xs text-slate-600">{items.length}</span>
      </div>

      {!items.length ? (
        <div className="py-10 text-center text-base text-slate-400">
          Channel feed is waiting for the first current-day snapshot.
        </div>
      ) : null}

      {unreadCount > 0 ? (
        <div className="pointer-events-none sticky top-0 z-20 py-1.5">
          <div className="pointer-events-auto">
            <NewMessagesBanner count={unreadCount} sinceLabel={unreadSinceLabel} onJump={scrollToBottom} />
          </div>
        </div>
      ) : null}

      <div className="space-y-1 pb-20">
        {groups.map((group) => (
          <FeedGroup
            key={group.id}
            group={group}
            onSelectSymbol={onSelectSymbol}
            showUnreadMarker={firstUnreadGroupId === group.id}
          />
        ))}
      </div>

      {!isNearPresent ? <JumpToPresent count={unreadCount} onClick={scrollToBottom} /> : null}
    </section>
  );
}
