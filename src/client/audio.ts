/** Lightweight original Web Audio effects, unlocked only by user interaction. */
export class GameAudio {
  private context: AudioContext | null = null;
  private volume = 0.7;
  setVolume(percent: number): void { this.volume = Math.max(0, Math.min(1, percent / 100)); }
  play(kind: 'click' | 'start' | 'buy' | 'finish' = 'click'): void {
    if (!this.volume) return;
    try {
      // This method is invoked by real pointer/keyboard game actions only.
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = kind === 'finish' ? 'triangle' : 'sine';
      const start = kind === 'buy' ? 620 : kind === 'start' ? 420 : kind === 'finish' ? 520 : 480;
      oscillator.frequency.setValueAtTime(start, now);
      oscillator.frequency.exponentialRampToValueAtTime(start * (kind === 'finish' ? 1.5 : 1.14), now + 0.10);
      const level = this.volume * (kind === 'click' ? 0.042 : 0.072);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(level, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.15);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch { /* Audio APIs may be restricted, but the game remains usable. */ }
  }
}
