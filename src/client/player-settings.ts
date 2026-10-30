/** Personal, browser-local preferences; never part of config/*.json or editor ZIPs. */
const STORE_KEY = 'poketactics.player-settings.v1';
export type PlayerPreferences = { volume: number; fps: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));
function readPreferences(): PlayerPreferences {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Partial<PlayerPreferences>;
    return { volume: Number.isFinite(data.volume) ? clamp(data.volume!, 0, 100) : 70,
      fps: Number.isFinite(data.fps) ? clamp(data.fps!, 30, 120) : 75 };
  } catch {
    return { volume: 70, fps: 75 };
  }
}
export class PlayerSettings {
  private value = readPreferences();
  private panel = document.getElementById('playerSettings')!;
  private volume = document.getElementById('playerVolume') as HTMLInputElement;
  private fps = document.getElementById('playerFps') as HTMLInputElement;
  constructor(private onVolume: (value: number) => void, private onFps: (value: number) => void) {
    this.volume.value = String(this.value.volume);
    this.fps.value = String(this.value.fps);
    this.updateLabels();
    this.onVolume(this.value.volume);
    this.onFps(this.value.fps);
    this.volume.addEventListener('input', () => this.change('volume', this.volume));
    this.fps.addEventListener('input', () => this.change('fps', this.fps));
    document.getElementById('closePlayerSettings')!.addEventListener('click', () => this.close());
    this.panel.addEventListener('click', event => { if (event.target === this.panel) this.close(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.isOpen()) { event.stopImmediatePropagation(); this.close(); }
    }, true);
  }
  get frameRate(): number { return this.value.fps; }
  isOpen(): boolean { return !this.panel.classList.contains('hidden'); }
  open(): void { this.panel.classList.remove('hidden'); this.volume.focus(); }
  close(): void { this.panel.classList.add('hidden'); }
  private change(key: keyof PlayerPreferences, input: HTMLInputElement): void {
    this.value[key] = clamp(Number(input.value), key === 'fps' ? 30 : 0, key === 'fps' ? 120 : 100);
    this.updateLabels();
    if (key === 'fps') this.onFps(this.value.fps);
    else this.onVolume(this.value.volume);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.value)); } catch { /* Storage can be disabled. */ }
  }
  private updateLabels(): void {
    document.getElementById('volumeValue')!.textContent = `${this.value.volume}%`;
    document.getElementById('fpsValue')!.textContent = `${this.value.fps} FPS`;
  }
}
