// The pictures of the Pairing tile, drawn as BombVault draws its own: one per
// step card and one per relay route. Each is the frame it rests on, set in
// motion by the stylesheet (`.al-scene-*` and `.al-route-*` in index.css), so
// it stands still wherever motion is off. They draw with the theme's tokens
// and take the hue of the card they sit in.
import { useId, type CSSProperties, type ReactNode } from 'react'

import { IconCheck, IconCopy } from '../../../components/glyphs'
import { LOGO_GOLD, LogoMark } from '../../../components/LogoMark'
import type { RelayMode } from '../../../lib/api'
import type { Translate } from '../../../lib/i18n'
import type { SceneStops } from '../../../lib/sceneStops'
import parleyport from '../../../assets/parleyport.svg'

/** The relay's name, which no language changes. */
export const RELAY_NAME = 'ParleyPort'

/** The spots the pointer visits on the three step cards. */
export const STEP_STOPS: SceneStops = {
  gen: [0, 120, 26],
  copy: [0, 192, 114],
  enter: [1, 120, 26],
  paste: [1, 192, 114],
  hold: [2, 120, 80],
  done: [2, 168, 30],
}

function At({ x, y, className, children }: { x: number; y: number; className?: string; children: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`} className={className}>
      {children}
    </g>
  )
}

/** An instance, by its top left corner. */
function Instance({ x, y, size, faded = false }: { x: number; y: number; size: number; faded?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={faded ? 0.45 : undefined}>
      <LogoMark size={size} style={{ color: LOGO_GOLD }} />
    </g>
  )
}

/** A message between two instances, with the small lock of what is sealed end to end. */
function Letter() {
  return (
    <>
      <rect className="al-scene-seal" x="-9" y="-6.5" width="18" height="13" rx="2.5" />
      <path className="al-scene-cut-line" d="M-6.8 -4.2 0 .8 6.8 -4.2" strokeLinejoin="round" />
      <g transform="translate(7.5 5)">
        <circle className="al-route-ground" r="4.6" />
        <rect className="al-scene-seal" x="-2.1" y="-.7" width="4.2" height="3.4" rx=".8" />
        <path className="al-route-shackle" d="M-1.3 -.7v-1a1.3 1.3 0 0 1 2.6 0v1" />
      </g>
    </>
  )
}

/** A letter on its way along a path, in sight only while the picture moves. */
function Travel({ path, leg, back = false }: { path: string; leg: 'arc' | 'in' | 'out'; back?: boolean }) {
  return (
    <g className={`al-letter al-letter-${leg}${back ? ' al-letter-back' : ''}`} style={{ offsetPath: `path("${path}")` } as CSSProperties}>
      <g className="al-letter-size">
        <Letter />
      </g>
    </g>
  )
}

/** Where a letter rests while the picture stands still. */
function Parked({ x, y }: { x: number; y: number }) {
  return (
    <At x={x} y={y} className="al-letter-parked">
      <Letter />
    </At>
  )
}

function Area({ x, width, label }: { x: number; width: number; label: string }) {
  return (
    <>
      <rect className="al-route-box" x={x} y="20" width={width} height="98" rx="18" />
      <text className="al-route-caption" x={x + width / 2} y="138" fontSize={12} textAnchor="middle">
        {label}
      </text>
    </>
  )
}

function Pill({ x, y, width, label }: { x: number; y: number; width: number; label: string }) {
  return (
    <At x={x} y={y}>
      <rect className="al-route-pill" x={-width / 2} y="-9" width={width} height="18" rx="6" />
      <text className="al-route-pill-text" y="3.5" fontSize={9.5} textAnchor="middle">
        {label}
      </text>
    </At>
  )
}

/**
 * How a message travels on one relay route. Without a relay it stops at the
 * cross, since every instance reaches the others only through one.
 */
export function RouteDiagram({ mode, t }: { mode: RelayMode; t: Translate }) {
  const here = t('relay.diagramYourNetwork')
  const there = t('relay.diagramOtherNetwork')
  let body: ReactNode
  if (mode === 'off') {
    body = (
      <>
        <Area x={8} width={104} label={here} />
        <Area x={248} width={104} label={there} />
        <path className="al-route-blocked" d="M92 70 H268" />
        <path className="al-route-cross" d="M175 64l10 12M185 64l-10 12" />
        <Instance x={32} y={42} size={56} />
        <Instance x={272} y={42} size={56} faded />
        <At x={158} y={70}>
          <g className="al-letter-refused">
            <Letter />
          </g>
        </At>
        <At x={180} y={70}>
          <circle className="al-route-refusal" r="6" />
        </At>
      </>
    )
  } else {
    body = (
      <>
        <Area x={8} width={104} label={here} />
        <Area x={248} width={104} label={there} />
        <path className="al-route-flow" d="M90 70 Q120 58 148 70 M212 70 Q240 82 270 70" />
        <At x={180} y={70}>
          <circle className="al-route-ring al-relay-ring" r="30" />
        </At>
        <g className="al-relay-hop">
          <image href={parleyport} x="148" y="38" width="64" height="62" />
        </g>
        <text className="al-route-name" x="180" y="138" fontSize={12} textAnchor="middle">
          {RELAY_NAME}
        </text>
        {mode === 'own' && <Pill x={180} y={155} width={84} label={t('relay.pic.selfHosted')} />}
        <Instance x={32} y={42} size={56} />
        <Instance x={272} y={42} size={56} />
        <Travel path="M90 70 Q120 58 150 70 L180 70" leg="in" />
        <Travel path="M180 70 L210 70 Q240 82 270 70" leg="out" />
        <Travel path="M270 70 Q240 82 210 70 L180 70" leg="in" back />
        <Travel path="M180 70 L150 70 Q120 58 90 70" leg="out" back />
        <Parked x={120} y={64} />
        <Parked x={240} y={76} />
      </>
    )
  }
  return (
    <div className="al-scene-frame al-route" data-mode={mode}>
      <svg viewBox="0 0 360 166" role="img" aria-label={t(mode === 'off' ? 'relay.pic.off' : 'relay.pic.relay')}>
        {body}
      </svg>
    </div>
  )
}

/** The twelve words the step pictures show. They belong to no real group. */
const SAMPLE_WORDS = ['anchor', 'breeze', 'candy', 'dove', 'ember', 'fjord', 'granite', 'harbor', 'island', 'jade', 'kiwi', 'lunar']

/** When something on a step card happens, as a share of the scene's loop. */
function at(share: number): CSSProperties {
  return { '--step-at': share } as CSSProperties
}

function Press({ x, y, width, height, rx, when }: { x: number; y: number; width: number; height: number; rx: number; when: number }) {
  return <rect className="al-scene-press" x={x} y={y} width={width} height={height} rx={rx} style={at(when)} />
}

/** A long label is squeezed into its room rather than run past it. */
function squeeze(label: string, room: number, perChar: number) {
  return label.length * perChar > room ? { textLength: room, lengthAdjust: 'spacingAndGlyphs' as const } : {}
}

/** The choice the phrase card shows, drawn small: its glyph tile and title. */
function ChoiceTile({ glyph, title, when }: { glyph: 'create' | 'enter'; title: string; when: number }) {
  return (
    <>
      <rect className="al-scene-tile" x="8" y="8" width="224" height="38" rx="9" />
      <rect className="al-scene-seal al-scene-corner" x="14" y="14" width="26" height="26" rx="7" />
      <g transform="translate(17 17)" className="al-scene-cut">
        <PhraseGlyph kind={glyph} size={20} />
      </g>
      <text className="al-scene-title" x="48" y="30.5" fontSize={11} {...squeeze(title, 176, 6.2)}>
        {title}
      </text>
      <Press x={8} y={8} width={224} height={38} rx={9} when={when} />
    </>
  )
}

function WordGrid({ x0, y0, width, gap, from, step, span, ground }: {
  x0: number
  y0: number
  width: number
  gap: number
  /** When the first word shows, and how long after it each next one does. */
  from: number
  step: number
  span: 'early' | 'mid'
  ground: 'tile' | 'field'
}) {
  return (
    <>
      {SAMPLE_WORDS.map((word, k) => {
        const x = x0 + (k % 4) * (width + gap)
        const y = y0 + Math.floor(k / 4) * 15
        return (
          <g key={word} className={`al-scene-show-${span}`} style={at(from + k * step)}>
            <rect className={ground === 'tile' ? 'al-scene-chip' : 'al-scene-chip al-scene-chip-field'} x={x} y={y} width={width} height="12" rx="6" />
            <text className="al-scene-chip-text" x={x + width / 2} y={y + 8.5} fontSize={6.8} textAnchor="middle">
              {word}
            </text>
          </g>
        )
      })}
    </>
  )
}

function PictureButton({ label, done, when }: { label: string; done?: string; when: number }) {
  const face = (text: string, glyph: ReactNode, className: string) => (
    <g className={className}>
      <g transform="translate(160 109) scale(.71)">{glyph}</g>
      <text x="174" y="117.5" fontSize={8.5} {...squeeze(text, 52, 4.8)}>
        {text}
      </text>
    </g>
  )
  return (
    <>
      <rect className="al-scene-button" x="152" y="104" width="80" height="20" rx="10" />
      {face(label, <IconCopy />, done ? 'al-scene-face al-scene-face-plain' : 'al-scene-face')}
      {done && face(done, <IconCheck />, 'al-scene-face al-scene-face-done')}
      <Press x={152} y={104} width={80} height={20} rx={10} when={when} />
    </>
  )
}

const CONFETTI = Array.from({ length: 28 }, (_, k) => {
  const dx = ((k * 37) % 220) - 110
  return {
    '--peak-x': `${dx / 2}px`,
    '--peak-y': `${-26 - (k % 4) * 6}px`,
    '--fall-x': `${dx}px`,
    '--fall-y': `${30 + ((k * 53) % 75)}px`,
    '--spin': `${k % 2 ? 360 : -360}deg`,
  } as CSSProperties
})

/**
 * The drawing on step card 1, 2 or 3. The three play one scene: a phrase is
 * made and copied on the first instance, pasted on the next, and the two
 * approve each other.
 */
export function StepPicture({ step, t }: { step: 1 | 2 | 3; t: Translate }) {
  let body: ReactNode
  if (step === 1) {
    body = (
      <>
        <ChoiceTile glyph="create" title={t('pairing.create')} when={0.09} />
        <WordGrid x0={8} y0={56} width={50} gap={8.67} from={0.11} step={0.006} span="early" ground="tile" />
        <PictureButton label={t('common.copy')} done={t('common.copied')} when={0.21} />
      </>
    )
  } else if (step === 2) {
    body = (
      <>
        <ChoiceTile glyph="enter" title={t('pairing.enter')} when={0.43} />
        <rect className="al-scene-field" x="8" y="52" width="224" height="48" rx="9" />
        <rect className="al-scene-focus" x="8" y="52" width="224" height="48" rx="9" />
        <text className="al-scene-hint" x="120" y="80" fontSize={8} textAnchor="middle">
          {t('pairing.pic.pasteWords')}
        </text>
        <WordGrid x0={14} y0={56} width={48} gap={6} from={0.525} step={0.005} span="mid" ground="field" />
        <PictureButton label={t('pairing.paste')} when={0.51} />
      </>
    )
  } else {
    const approved = t('pairing.approved')
    body = (
      <>
        <path className="al-scene-blocked" d="M76 80H164" />
        <path className="al-scene-link" d="M76 80H164" />
        <Instance x={28} y={56} size={48} />
        <Instance x={164} y={56} size={48} />
        <At x={120} y={80}>
          <g className="al-scene-lock">
            <circle className="al-scene-seal" r="9" />
            <rect className="al-scene-hole" x="-4" y="-1.2" width="8" height="6.4" rx="1.4" />
            <path className="al-scene-cut-line" d="M-2.4 -1.2v-1.9a2.4 2.4 0 0 1 4.8 0v1.9" />
          </g>
        </At>
        <At x={84} y={80}>
          <g className="al-scene-file">
            <Letter />
          </g>
        </At>
        <At x={120} y={22}>
          <circle className="al-scene-ring" r="14" />
          <g className="al-scene-badge">
            <g className="al-scene-badge-pop">
              <rect className="al-scene-badge-ground" x="-56" y="-13" width="112" height="26" rx="13" />
              <g transform="translate(-45 -5) scale(.71)" className="al-scene-badge-ink">
                <IconCheck />
              </g>
              <text className="al-scene-badge-text" x="7" y="4.5" fontSize={12} textAnchor="middle" {...squeeze(approved, 80, 7.2)}>
                {approved}
              </text>
            </g>
          </g>
          {CONFETTI.map((flight, k) => (
            <g key={k} className="al-scene-confetti" style={flight}>
              <rect className={`al-scene-confetti-${k % 4}`} x="-2" y="-3.5" width="4" height="7" rx="1" />
            </g>
          ))}
        </At>
      </>
    )
  }
  return (
    <svg viewBox="0 0 240 130" aria-hidden="true" data-step={step} className="al-scene-pic">
      {body}
    </svg>
  )
}

const CLOUD = 'M5.4 16.5h9.2a3.9 3.9 0 0 0 .6-7.8A5.4 5.4 0 0 0 4.9 7.3a4.6 4.6 0 0 0 .5 9.2z'

/** A relay route as a filled glyph, the way the selector's other glyphs are drawn. */
export function RouteGlyph({ kind }: { kind: RelayMode | 'relay' }) {
  // useId has colons, which a url(#...) reference does not take in every browser.
  const cut = `route-cut${useId().replace(/[^\w-]/g, '')}`
  const box = { viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': true as const }
  switch (kind) {
    case 'project':
      return (
        <svg {...box} fill="currentColor">
          <path d={CLOUD} />
        </svg>
      )
    case 'own':
      return (
        <svg {...box} fill="currentColor">
          <path d="M10 2.4 2.3 9.2c-.5.4-.2 1.2.5 1.2h1.6V17a1 1 0 0 0 1 1h3.1v-4.6h3V18h3.1a1 1 0 0 0 1-1v-6.6h1.6c.7 0 1-.8.5-1.2z" />
        </svg>
      )
    case 'off':
      // The slash is cut out of the cloud so it reads on any ground.
      return (
        <svg {...box} fill="currentColor">
          <mask id={cut}>
            <rect width="20" height="20" fill="white" />
            <path d="M3 3l14 14" stroke="black" strokeWidth="3.6" strokeLinecap="round" />
          </mask>
          <path d={CLOUD} mask={`url(#${cut})`} />
          <path d="M3.2 3.2l13.6 13.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'relay':
      return (
        <svg {...box} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 7h12M12.5 4l3 3-3 3M16.5 13h-12M7.5 10l-3 3 3 3" />
        </svg>
      )
  }
}

/** The glyph at the start of a fact line on the relay card. */
export function FactGlyph({ kind }: { kind: 'need' | 'sees' | 'hidden' | 'lock' }) {
  const common = {
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    className: 'mt-0.5 shrink-0',
  }
  switch (kind) {
    case 'need':
      return (
        <svg {...common}>
          <path d="M5 2.5h6M5 2.5a1 1 0 0 0-1 1V14h8V3.5a1 1 0 0 0-1-1" />
          <path d="M6.2 7.3l1.3 1.3 2.4-2.6M6.2 11h3.6" />
        </svg>
      )
    case 'sees':
      return (
        <svg {...common}>
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2.1" />
        </svg>
      )
    case 'hidden':
      return (
        <svg {...common}>
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2.1" />
          <path d="M2.6 2.6l10.8 10.8" />
        </svg>
      )
    case 'lock':
      return (
        <svg {...common}>
          <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" stroke="none" />
          <path d="M5.2 7V5.1a2.8 2.8 0 0 1 5.6 0V7" />
        </svg>
      )
  }
}

/** The glyphs of the phrase card: its two ways in, the next step and the path to it, and the warning. */
export function PhraseGlyph({ kind, size = 16 }: { kind: 'create' | 'enter' | 'arrow' | 'chevron' | 'warn'; size?: number }) {
  const common = {
    viewBox: '0 0 20 20',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
    className: 'shrink-0',
  }
  switch (kind) {
    case 'create':
      return (
        <svg {...common} strokeWidth={1.8}>
          <rect x="3" y="3" width="14" height="14" rx="3.5" />
          <path d="M10 6.8v6.4M6.8 10h6.4" />
        </svg>
      )
    case 'enter':
      return (
        <svg {...common} strokeWidth={1.6}>
          <rect x="2.5" y="5" width="15" height="10" rx="2.2" />
          <path d="M5.5 8.2h.01M8.5 8.2h.01M11.5 8.2h.01M14.5 8.2h.01M6.5 11.8h7" />
        </svg>
      )
    case 'arrow':
      return (
        <svg {...common} strokeWidth={2.4} className="shrink-0 rtl:-scale-x-100">
          <path d="M3.8 10h11.9M11.3 5.6 15.7 10l-4.4 4.4" />
        </svg>
      )
    case 'chevron':
      return (
        <svg {...common} strokeWidth={2.4} className="shrink-0 rtl:-scale-x-100">
          <path d="M7.5 4.2 13.3 10l-5.8 5.8" />
        </svg>
      )
    case 'warn':
      return (
        <svg {...common} strokeWidth={1.7}>
          <path d="M10 3 18 16.5H2z" />
          <path d="M10 8.2v3.6" />
          <circle cx="10" cy="14.1" r=".9" fill="currentColor" stroke="none" />
        </svg>
      )
  }
}
