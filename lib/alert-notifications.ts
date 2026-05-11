import type { LiveEvent } from "./live-events";
import type { AlertClientSettings, SoundMode } from "./alert-reasoning";

export type AlertToastPayload = {
  id: string;
  title: string;
  body: string;
  symbol: string;
  priority: LiveEvent["priority"];
};

export function buildToastFromEvent(event: LiveEvent): AlertToastPayload {
  return {
    id: event.id,
    title: event.title,
    body: event.summary,
    symbol: event.symbol,
    priority: event.priority,
  };
}

export function shouldToastEvent(event: LiveEvent, settings: AlertClientSettings) {
  if (!settings.toastNotifications) {
    return false;
  }

  if (settings.onlyHighPriority && event.priority !== "high") {
    return false;
  }

  return event.priority !== "low";
}

export function shouldBrowserNotifyEvent(event: LiveEvent, settings: AlertClientSettings) {
  if (!settings.browserNotifications) {
    return false;
  }

  if (settings.onlyHighPriority && event.priority !== "high") {
    return false;
  }

  return event.priority === "high" || event.priority === "medium";
}

export function shouldPlaySoundForEvent(event: LiveEvent, soundMode: SoundMode) {
  if (soundMode === "off") {
    return false;
  }

  if (soundMode === "important") {
    return event.priority === "high";
  }

  return event.priority === "high" || event.priority === "medium";
}

const lastSoundAtByPriority: Partial<Record<LiveEvent["priority"], number>> = {};

export function playNotificationTone(soundMode: SoundMode, priority: LiveEvent["priority"]) {
  if (typeof window === "undefined") {
    return;
  }

  if (!shouldPlaySoundForEvent({ priority } as LiveEvent, soundMode)) {
    return;
  }

  const now = Date.now();
  const minGapMs = priority === "high" ? 1800 : 3200;
  const lastPlayedAt = lastSoundAtByPriority[priority] ?? 0;
  if (now - lastPlayedAt < minGapMs) {
    return;
  }
  lastSoundAtByPriority[priority] = now;

  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = priority === "high" ? "triangle" : "sine";
    oscillator.frequency.value = priority === "high" ? 880 : 660;
    gainNode.gain.value = 0.0001;
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (priority === "high" ? 0.28 : 0.18));
    oscillator.stop(context.currentTime + (priority === "high" ? 0.3 : 0.2));
    void context.close().catch(() => undefined);
  } catch {
    // Ignore audio policy/runtime failures.
  }
}

export async function ensureBrowserNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission === "denied") {
    return false;
  }

  return (await Notification.requestPermission()) === "granted";
}

export function fireBrowserNotification(payload: AlertToastPayload) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(payload.title, { body: payload.body });
  }
}
