"use client";

// Small device feedback for the tools: a beep and a vibration. Both fail silently.

let context: AudioContext | null = null;

/** Call from a tap: browsers only allow sound after a user gesture. */
export function primeAudio() {
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {
    // no Web Audio
  }
}

export function beep(times = 1, frequency = 880) {
  if (!context) return;
  const start = context.currentTime;
  for (let i = 0; i < times; i++) {
    const at = start + i * 0.3;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.22);
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // not supported
  }
}

/** Animations are skipped for people who asked their device for less motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
