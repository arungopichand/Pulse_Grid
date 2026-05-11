"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const CHAT_STORAGE_KEY = "pulsegrid-copilot-history-v1";
const MAX_PERSISTED_MESSAGES = 40;

type StreamEvent =
  | { event: "meta"; data: { usedTools?: string[] } }
  | { event: "delta"; data: { text?: string } }
  | { event: "done"; data: { text?: string } };

function toId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseSseChunk(chunk: string) {
  const blocks = chunk.split("\n\n").filter(Boolean);
  const events: StreamEvent[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));
    if (!eventLine || !dataLine) {
      continue;
    }

    const event = eventLine.slice(7).trim();
    const dataText = dataLine.slice(6).trim();
    try {
      const data = JSON.parse(dataText) as Record<string, unknown>;
      if (event === "meta") {
        events.push({
          event: "meta",
          data: {
            usedTools: Array.isArray(data.usedTools)
              ? data.usedTools.filter((tool): tool is string => typeof tool === "string")
              : [],
          },
        });
      }

      if (event === "delta") {
        events.push({
          event: "delta",
          data: {
            text: typeof data.text === "string" ? data.text : "",
          },
        });
      }

      if (event === "done") {
        events.push({
          event: "done",
          data: {
            text: typeof data.text === "string" ? data.text : "",
          },
        });
      }
    } catch {
      continue;
    }
  }

  return events;
}

function normalizeStoredMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-MAX_PERSISTED_MESSAGES)
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const candidate = item as Record<string, unknown>;
      const role = candidate.role;
      const content = candidate.content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        return [];
      }

      const trimmed = content.trim();
      if (!trimmed) {
        return [];
      }

      return [
        {
          id: typeof candidate.id === "string" ? candidate.id : toId(role),
          role,
          content: trimmed.slice(0, 2_000),
        } satisfies ChatMessage,
      ];
    });
}

export function SupportAgentPanel() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedTools, setUsedTools] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const streamBufferRef = useRef("");

  const hasMessages = messages.length > 0;
  const canSubmit = input.trim().length > 0 && !loading;
  const orderedTools = useMemo(() => Array.from(new Set(usedTools)), [usedTools]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      setMessages(normalizeStoredMessages(parsed));
    } catch {
      // Ignore localStorage parse errors.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const toPersist = messages.slice(-MAX_PERSISTED_MESSAGES);
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toPersist));
  }, [messages]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userText = input.trim();
    if (!userText || loading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: toId("user"),
      role: "user",
      content: userText,
    };
    const assistantMessageId = toId("assistant");
    const conversation = [...messages, userMessage];

    setInput("");
    setError(null);
    setLoading(true);
    setUsedTools([]);
    setMessages([...conversation, { id: assistantMessageId, role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/agent/support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: conversation.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      streamBufferRef.current = "";

      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (done) {
          break;
        }

        streamBufferRef.current += decoder.decode(result.value, { stream: true });
        const parsed = parseSseChunk(streamBufferRef.current);

        // Keep any incomplete event in the buffer.
        const tail = streamBufferRef.current.lastIndexOf("\n\n");
        streamBufferRef.current = tail === -1 ? streamBufferRef.current : streamBufferRef.current.slice(tail + 2);

        for (const parsedEvent of parsed) {
          if (parsedEvent.event === "meta") {
            setUsedTools(parsedEvent.data.usedTools ?? []);
            continue;
          }

          if (parsedEvent.event === "delta" && parsedEvent.data.text) {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: `${message.content}${parsedEvent.data.text ?? ""}`,
                    }
                  : message,
              ),
            );
          }

          if (parsedEvent.event === "done" && typeof parsedEvent.data.text === "string") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: parsedEvent.data.text ?? message.content,
                    }
                  : message,
              ),
            );
          }
        }
      }
    } catch {
      setError("Support agent is temporarily unavailable.");
      setMessages((current) => current.filter((message) => message.id !== assistantMessageId));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="fixed right-4 bottom-4 z-40 w-[min(100vw-2rem,24rem)]">
      <div className="glass-panel border border-white/12 bg-surface-900/90">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          className="flex w-full items-center justify-between px-3 py-2 text-left"
        >
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">PulseGrid Copilot</div>
            <p className="text-xs text-slate-300">Product and code support</p>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400">
            {isOpen ? "Hide" : "Open"}
          </span>
        </button>

        {isOpen ? (
          <div className="border-t border-white/10 p-3">
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {!hasMessages ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2 text-xs text-slate-400">
                  Ask about this app&apos;s routes, signal logic, live session behavior, or implementation decisions.
                </div>
              ) : null}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-lg border p-2 text-xs leading-relaxed ${
                    message.role === "user"
                      ? "border-accent-blue/40 bg-accent-blue/10 text-slate-100"
                      : "border-white/10 bg-white/[0.02] text-slate-200"
                  }`}
                >
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">
                    {message.role === "user" ? "You" : "Copilot"}
                  </div>
                  <p className="whitespace-pre-wrap">{message.content || (loading ? "Thinking..." : "")}</p>
                </div>
              ))}
            </div>

            {orderedTools.length ? (
              <p className="mt-2 text-[11px] text-slate-400">Tools used: {orderedTools.join(", ")}</p>
            ) : null}
            {error ? <p className="mt-2 text-[11px] text-amber-200">{error}</p> : null}

            <form onSubmit={handleSubmit} className="mt-3 space-y-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask a product or implementation question..."
                className="h-20 w-full rounded-lg border border-white/12 bg-surface-950/70 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-accent-blue/60"
                maxLength={2000}
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{input.length}/2000</span>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-md border border-accent-blue/60 bg-accent-blue/20 px-3 py-1 text-xs font-medium text-slate-100 transition enabled:hover:bg-accent-blue/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Working..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}
