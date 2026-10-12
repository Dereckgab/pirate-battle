const SOUND_FILES = {
  cannon: 'cannon_fire_1.wav',
  broadside: 'cannon_broadside.wav',
  enemyCannon: 'cannon_fire_3.wav',
  woodHit: 'ship_wood_hit_1.wav',
  splash: 'cannonball_water_hit_1.wav',
  explosion: 'ship_explosion_1.wav',
  collision: 'ship_collision.wav',
  point: 'score_point.wav',
  gameStart: 'game_start.wav',
  gameOver: 'game_over.wav',
  gameComplete: 'game_complete.wav',
  pause: 'game_pause.wav',
  resume: 'game_resume.wav',
  click: 'ui_click.wav',
  ambience: 'ocean_ambience_loop.wav',
} as const

export type SoundName = keyof typeof SOUND_FILES

/**
 * Minimal Web Audio wrapper. Sounds are decoded lazily and cached; failures are silent
 * because audio is never required to play.
 */
class AudioManager {
  private context: AudioContext | null = null
  private readonly buffers = new Map<SoundName, Promise<AudioBuffer | null>>()
  private readonly lastPlayed = new Map<SoundName, number>()
  private ambience: AudioBufferSourceNode | null = null
  private ambienceRequested = false
  enabled = true

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof AudioContext === 'undefined') return null
    this.context ??= new AudioContext()
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined)
    return this.context
  }

  private load(name: SoundName, context: AudioContext): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(name)
    if (!buffer) {
      buffer = fetch(`${import.meta.env.BASE_URL}assets/sounds/${SOUND_FILES[name]}`)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return response.arrayBuffer()
        })
        .then((data) => context.decodeAudioData(data))
        .catch(() => null)
      this.buffers.set(name, buffer)
    }
    return buffer
  }

  play(name: SoundName, volume = 0.5): void {
    const context = this.getContext()
    if (!context) return
    // Avoid stacking the same sample many times within a few milliseconds.
    const now = performance.now()
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < 60) return
    this.lastPlayed.set(name, now)
    void this.load(name, context).then((buffer) => {
      if (!buffer || !this.enabled || context.state !== 'running') return
      const source = context.createBufferSource()
      const gain = context.createGain()
      gain.gain.value = volume
      source.buffer = buffer
      source.connect(gain).connect(context.destination)
      source.start()
    })
  }

  startAmbience(): void {
    const context = this.getContext()
    if (!context || this.ambienceRequested) return
    this.ambienceRequested = true
    void this.load('ambience', context).then((buffer) => {
      if (!buffer || !this.ambienceRequested || !this.enabled) return
      const source = context.createBufferSource()
      const gain = context.createGain()
      gain.gain.value = 0.18
      source.buffer = buffer
      source.loop = true
      source.connect(gain).connect(context.destination)
      source.start()
      this.ambience = source
    })
  }

  stopAmbience(): void {
    this.ambienceRequested = false
    try {
      this.ambience?.stop()
    } catch {
      // Already stopped.
    }
    this.ambience?.disconnect()
    this.ambience = null
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.stopAmbience()
  }
}

export const audio = new AudioManager()
