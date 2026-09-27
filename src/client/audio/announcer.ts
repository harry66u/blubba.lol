/**
 * Hype announcer using the browser's built-in speech synthesis (no downloads). Every line also
 * appears as big on-screen text, so nothing is lost with sound off.
 */
export class Announcer {
  private volume = 1;
  private voice: SpeechSynthesisVoice | null = null;
  private lastAt = 0;
  private lastPriority = 0;
  private readonly synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  constructor() {
    if (!this.synth) return;
    const pick = () => {
      const voices = this.synth!.getVoices().filter((v) => v.lang.startsWith('en'));
      // Prefer lively, clear voices that ship with macOS and Chrome.
      const prefs = ['Samantha', 'Google US English', 'Alex', 'Daniel', 'Karen', 'Moira'];
      this.voice = prefs.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) ?? voices[0] ?? null;
    };
    pick();
    this.synth.addEventListener?.('voiceschanged', pick);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (v <= 0) this.synth?.cancel();
  }

  /** Speaks a line unless a more important one is still playing. */
  say(text: string, priority = 1): void {
    if (!this.synth || this.volume <= 0) return;
    const now = performance.now();
    const busy = this.synth.speaking && now - this.lastAt < 1800;
    if (busy && priority <= this.lastPriority) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 1.12;
    u.pitch = 1.25;
    u.volume = Math.min(1, this.volume);
    this.synth.speak(u);
    this.lastAt = now;
    this.lastPriority = priority;
  }
}
