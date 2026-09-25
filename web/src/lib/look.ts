import { SHAPES_STORED, type Shape } from './appearance'

/**
 * What appearance.ts cached for the first paint. The app starts from it too,
 * or its defaults would overwrite the stored look on every load.
 */
export function storedLook(): { shape?: Shape; accent?: string } {
  try {
    const raw = localStorage.getItem('glim-appearance')
    if (!raw) return {}
    const { shape, accent } = JSON.parse(raw) as { shape?: Shape; accent?: string }
    return { shape: shape && SHAPES_STORED.includes(shape) ? shape : undefined, accent }
  } catch {
    return {}
  }
}

const SLOTS = 'arrowloop-accent-slots'

/**
 * The colour each accent swatch holds. A swatch edited in the picker keeps its
 * colour after another one is chosen, as in BombVault.
 */
export function storedSlots(presets: string[]): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SLOTS) ?? '[]') as unknown
    if (!Array.isArray(saved)) return presets
    return presets.map((hex, i) => {
      const own = saved[i]
      return typeof own === 'string' && /^#[0-9a-f]{6}$/i.test(own) ? own : hex
    })
  } catch {
    return presets
  }
}

export function storeSlots(slots: string[]): void {
  try {
    localStorage.setItem(SLOTS, JSON.stringify(slots))
  } catch {
    // Without storage an edited swatch lasts until the page is reloaded.
  }
}
