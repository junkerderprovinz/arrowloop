import { useRef, useState } from 'react'

import { Choice } from '../../components/Field'
import {
  IconCornerLeaf,
  IconCornerRound,
  IconCornerSoft,
  IconCornerSquare,
  IconMoon,
  IconMotionOff,
  IconMotionStorm,
  IconMotionSubtle,
  IconMotionWild,
  IconRefresh,
  IconSun,
  IconThemeSystem,
} from '../../components/glyphs'
import { Selector } from '../../components/Selector'
import { Stack } from '../../components/Shell'
import { AccentSwatches, PaletteSwatches } from '../../components/Swatches'
import { ToggleRow } from '../../components/ToggleRow'
import { wipeColours } from '../../lib/animate'
import { ACCENTS, leafTap, RAINBOW, type RainbowState, type Shape } from '../../lib/appearance'
import { BOTTOM_BAR_AXIS, CONTROL_AXES, LABEL_MODES, type LabelAxis, type LabelMode } from '../../lib/controls'
import { discoTap } from '../../lib/disco'
import { Button } from '../../lib/glimstone/Button'
import { Card } from '../../lib/glimstone/Card'
import { InfoBubble } from '../../lib/glimstone/InfoBubble'
import { useT } from '../../lib/i18n'
import { MOTION_INTENSITIES, type MotionIntensity } from '../../lib/motion'
import type { ThemeChoice } from '../../lib/theme'
import { counter, SettingsRow } from './rows'
import { isOwnOrder, setTileOrder, useTileOrder } from './tiles'

/** The house accent a reset returns to, the first preset. */
export const DEFAULT_ACCENT = ACCENTS[0]?.hex ?? '#FCC419'
export const PRESET_HEXES = ACCENTS.map((a) => a.hex)

export interface LookProps {
  theme: ThemeChoice
  onTheme: (next: ThemeChoice) => void
  shape: Shape
  onShape: (next: Shape) => void
  accent: string
  onAccent: (next: string) => void
  /** The colour each accent swatch holds. */
  slots: string[]
  onSlots: (next: string[]) => void
  rainbow: RainbowState
  onRainbow: (next: RainbowState) => void
  disco: boolean
  onDisco: (on: boolean) => void
  motion: MotionIntensity
  onMotion: (next: MotionIntensity) => void
  labels: Record<LabelAxis, LabelMode>
  onLabels: (axis: LabelAxis, next: LabelMode) => void
  lang: string
  onLang: (next: string) => void
  languages: { code: string; label: string; flag: string }[]
}

/** How many clicks on the chosen level open the one above the ceiling. */
const STORM_CLICKS = 5

/**
 * The storm, a hidden fourth motion level: with the motion on "wild", click
 * "wild" five more times.
 *
 * The discovery is not stored. The option shows while it is chosen, and
 * otherwise only while this screen stays open. The chosen value itself is
 * stored like any other (see MOTION_VALUES in lib/motion.ts). The phone runs
 * the same rule in mobile/src/eggs.tsx.
 */
function useStormUnlock(motion: MotionIntensity, onMotion: (next: MotionIntensity) => void) {
  const [found, setFound] = useState(false)
  const clicks = useRef(0)
  return {
    offered: found || motion === 'storm',
    click: (level: MotionIntensity) => {
      if (level !== 'wild' || motion !== 'wild') {
        clicks.current = 0
        return
      }
      clicks.current += 1
      if (clicks.current < STORM_CLICKS) return
      clicks.current = 0
      setFound(true)
      onMotion('storm')
    },
  }
}

/**
 * The leaf, a hidden fourth shape found the storm's way: with the corners on
 * "square", click "square" five more times. Offered by the same rule.
 */
function useLeafUnlock(shape: Shape, onShape: (next: Shape) => void) {
  const [found, setFound] = useState(false)
  const taps = useRef({ taps: 0 })
  return {
    offered: found || shape === 'leaf',
    click: (tapped: Shape) => {
      if (!leafTap(taps.current, tapped, shape)) return
      setFound(true)
      onShape('leaf')
    },
  }
}

/**
 * Disco, the colour engine's easter egg: turn Rainbow Mode on five times, each
 * within three seconds of the last, and the palette starts to walk. Like the
 * storm, the discovery is not stored; the switch shows while disco is on and
 * otherwise only while this screen stays open. The phone runs the same rule in
 * mobile/src/eggs.tsx.
 */
function useDiscoUnlock(disco: boolean, onDisco: (on: boolean) => void) {
  const [found, setFound] = useState(false)
  const taps = useRef({ taps: 0, last: 0 })
  return {
    offered: found || disco,
    turned: (on: boolean) => {
      if (!discoTap(taps.current, on, { now: performance.now() })) return
      setFound(true)
      onDisco(true)
    },
  }
}

/** The looks a person owns. */
export function LookPage({
  theme,
  onTheme,
  shape,
  onShape,
  accent,
  onAccent,
  slots,
  onSlots,
  rainbow,
  onRainbow,
  disco,
  onDisco,
  motion,
  onMotion,
  labels,
  onLabels,
  lang,
  onLang,
  languages,
}: LookProps) {
  const { t } = useT()
  const storm = useStormUnlock(motion, onMotion)
  const leaf = useLeafUnlock(shape, onShape)
  const discoUnlock = useDiscoUnlock(disco, onDisco)
  const selectorHue = counter()
  const tileOrder = useTileOrder()
  // A switch that changes the rainbow wipes across the page. A colour dragged
  // in the picker does not, since it has to follow the pointer.
  const switchRainbow = (next: RainbowState) => {
    wipeColours()
    onRainbow(next)
  }
  return (
    <Stack>
      <Card title={t('look.appearance')} hueIndex={0}>
        {/* First, because somebody who cannot read the screen comes looking
            for exactly this. */}
        <SettingsRow label={t('look.language')}>
          <div className="w-60 max-w-full">
            <Choice
              value={lang}
              onChange={onLang}
              label={t('look.language')}
              roomy
              options={languages.map((l) => ({ value: l.code, label: l.label, flag: l.flag }))}
            />
          </div>
        </SettingsRow>

        <SettingsRow label={t('look.design')}>
          <Selector<ThemeChoice>
            scale="small"
            low
            hug
            label={t('look.design')}
            hue={selectorHue()}
            value={theme}
            onChange={onTheme}
            options={[
              { value: 'dark', label: t('look.dark'), icon: <IconMoon /> },
              { value: 'light', label: t('look.light'), icon: <IconSun /> },
              { value: 'system', label: t('look.system'), icon: <IconThemeSystem /> },
            ]}
          />
        </SettingsRow>

        <SettingsRow label={t('look.corners')} hint={t('look.cornersHint')}>
          <Selector<Shape>
            scale="small"
            low
            hug
            label={t('look.corners')}
            hue={selectorHue()}
            value={shape}
            onChange={(next) => {
              onShape(next)
              leaf.click(next)
            }}
            options={[
              { value: 'round', label: t('look.round'), icon: <IconCornerRound /> },
              { value: 'soft', label: t('look.soft'), icon: <IconCornerSoft /> },
              { value: 'square', label: t('look.square'), icon: <IconCornerSquare /> },
              ...(leaf.offered ? [{ value: 'leaf' as Shape, label: t('look.leaf'), icon: <IconCornerLeaf /> }] : []),
            ]}
          />
        </SettingsRow>

        <SettingsRow label={t('look.motion')} hint={t('look.motionHint')}>
          <Selector<MotionIntensity>
            scale="small"
            low
            hug
            label={t('look.motion')}
            hue={selectorHue()}
            value={motion}
            onChange={(next) => {
              onMotion(next)
              storm.click(next)
            }}
            options={[
              ...MOTION_INTENSITIES.map((m) => ({ value: m, label: t(motionKey[m]), icon: motionGlyph[m] })),
              ...(storm.offered ? [{ value: 'storm' as MotionIntensity, label: t(motionKey.storm), icon: motionGlyph.storm }] : []),
            ]}
          />
        </SettingsRow>

        <SettingsRow label={t('look.tileOrder')} hint={t('look.tileOrderHint')}>
          <span data-new="tile-order" className="flex">
            <Button
              label={t('look.orderReset')}
              labelKey="look.orderReset"
              disabled={isOwnOrder(tileOrder)}
              onClick={() => setTileOrder(null)}
            />
          </span>
        </SettingsRow>
      </Card>

      <Card title={t('look.labels')} hueIndex={1} hint={t('look.labelsHint')}>
        {[...CONTROL_AXES, BOTTOM_BAR_AXIS].map((axis) => (
          <SettingsRow
            key={axis}
            label={t(axisKey[axis])}
            hint={axis === BOTTOM_BAR_AXIS ? t('look.barLabelsWeb') : undefined}
          >
            <Selector<LabelMode>
              scale="small"
              low
              hug
              label={t(axisKey[axis])}
              hue={selectorHue()}
              value={labels[axis]}
              onChange={(next) => onLabels(axis, next)}
              options={LABEL_MODES.map((m) => ({ value: m, label: t(labelModeKey[m]) }))}
            />
          </SettingsRow>
        ))}
      </Card>

      {/* Accent and rainbow share one card, last, as in BombVault: the accent
          is the rainbow's position zero. */}
      <Card title={t('look.colors')} hueIndex={2}>
        {/* The reset belongs to this row rather than to the card's action
            slot: it resets only the accent. */}
        <div className="flex flex-wrap items-center gap-3">
          <span data-glim-label={t('look.accent')} className={`text-body text-carbon-text${rainbow.on ? ' opacity-50' : ''}`}>
            {t('look.accent')}
          </span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {/* Inert while the rainbow hands out the colours. */}
            <AccentSwatches
              presets={ACCENTS}
              slots={slots}
              value={accent}
              onChange={onAccent}
              onSlots={onSlots}
              disabled={rainbow.on}
            />
            <ResetBadge
              tip={t('look.accentReset')}
              disabled={rainbow.on || (accent === DEFAULT_ACCENT && slots.join() === PRESET_HEXES.join())}
              onClick={() => {
                onAccent(DEFAULT_ACCENT)
                onSlots(PRESET_HEXES)
              }}
            />
          </div>
        </div>

        <ToggleRow
          checked={rainbow.on}
          onChange={(on) => {
            switchRainbow({ ...rainbow, on })
            discoUnlock.turned(on)
          }}
          label={t('look.rainbowOn')}
          hint={t('look.rainbowHint')}
          hueIndex={0}
        />
        {/* Reactive, rotate and the palette only mean something while the
            rainbow runs, so they are absent rather than dimmed when it is
            off. */}
        {rainbow.on && (
          <>
            <ToggleRow
              checked={rainbow.reactive}
              onChange={(reactive) => switchRainbow({ ...rainbow, reactive })}
              label={t('look.rainbowReactive')}
              hint={t('look.reactiveHint')}
              hueIndex={1}
            />
            <ToggleRow
              checked={rainbow.rotate}
              onChange={(rotate) => switchRainbow({ ...rainbow, rotate, seed: rotate ? (rainbow.seed + 1) % 8 : 0 })}
              label={t('look.rainbowRotate')}
              hint={t('look.rotateHint')}
              hueIndex={2}
            />
            {discoUnlock.offered && (
              <ToggleRow
                checked={disco}
                onChange={onDisco}
                label={t('look.disco')}
                hint={t('look.discoHint')}
                hueIndex={3}
              />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-body text-carbon-text">
                {t('look.palette')}
                <InfoBubble tip={t('look.paletteHint')} />
              </span>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <PaletteSwatches palette={rainbow.palette} onChange={(palette) => onRainbow({ ...rainbow, palette })} />
                <ResetBadge
                  tip={t('look.paletteReset')}
                  disabled={rainbow.palette.join() === RAINBOW.join()}
                  onClick={() => switchRainbow({ ...rainbow, palette: [...RAINBOW] })}
                />
              </div>
            </div>
          </>
        )}
      </Card>
    </Stack>
  )
}

/**
 * The reset at the end of a row of colour swatches. Always rendered and
 * disabled when there is nothing to undo, so the row never changes length.
 *
 * The one control outside the colour engine, as in BombVault: in a row of
 * swatches an accent fill would read as one more colour to pick.
 */
function ResetBadge({ tip, onClick, disabled }: { tip: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
      aria-label={tip}
      // Built like a swatch, a border around a fill, so it reads the same size.
      className="inline-flex h-7 w-7 items-center justify-center bg-carbon-surface2 text-carbon-textSub transition disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderRadius: 'var(--radius-pill)',
        border: '2px solid var(--carbon-border)',
      }}
    >
      <IconRefresh />
    </button>
  )
}

const motionKey = {
  off: 'look.motionOff',
  subtle: 'look.motionSubtle',
  wild: 'look.motionWild',
  storm: 'look.motionStorm',
} as const

const motionGlyph = {
  off: <IconMotionOff />,
  subtle: <IconMotionSubtle />,
  wild: <IconMotionWild />,
  storm: <IconMotionStorm />,
}

const axisKey = {
  buttons: 'look.labelsButtons',
  sidebar: 'look.labelsSidebar',
  tabs: 'look.labelsTabs',
  bottombar: 'look.barLabels',
} as const

const labelModeKey = {
  text: 'look.labelText',
  textGlyph: 'look.labelTextGlyph',
  glyph: 'look.labelGlyph',
  reactive: 'look.labelReactive',
} as const
