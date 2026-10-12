import { create } from 'zustand'
import { audio } from '../game/audio/AudioManager'
import { DEFAULT_PLAYER_OPTIONS, isValidOptions, type PlayerOptions } from '../game/config/gameConfig'
import { readJson, STORAGE_KEYS, writeJson } from '../lib/storage'

interface StoredOptions extends PlayerOptions {
  soundEnabled: boolean
}

function isStoredOptions(value: unknown): value is StoredOptions {
  return isValidOptions(value) && typeof (value as unknown as StoredOptions).soundEnabled === 'boolean'
}

interface OptionsState {
  options: PlayerOptions
  soundEnabled: boolean
  save: (options: PlayerOptions, soundEnabled: boolean) => void
}

const stored = readJson(STORAGE_KEYS.options, isStoredOptions)
audio.setEnabled(stored?.soundEnabled ?? true)

/** Player options, persisted locally. Invalid or missing stored data falls back to defaults. */
export const useOptionsStore = create<OptionsState>((set) => ({
  options: stored
    ? { sessionTimeSec: stored.sessionTimeSec, enemySpawnTimeSec: stored.enemySpawnTimeSec }
    : DEFAULT_PLAYER_OPTIONS,
  soundEnabled: stored?.soundEnabled ?? true,
  save: (options, soundEnabled) => {
    writeJson(STORAGE_KEYS.options, { ...options, soundEnabled } satisfies StoredOptions)
    audio.setEnabled(soundEnabled)
    set({ options, soundEnabled })
  },
}))
