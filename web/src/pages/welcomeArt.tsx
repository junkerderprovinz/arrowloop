// The pictures on the welcome page's three step cards. They play one scene,
// as the pairing pages of BombVault and KnightLoader do: a target is added on
// the first card, a job is set up on the second, and the third syncs it. Each
// is drawn as the frame it rests on and set in motion by the stylesheet
// (`.al-scene-*` in index.css), so it stands still wherever motion is off.
import type { CSSProperties, ReactNode } from 'react'

import { IconAdd, IconCheck, IconFolder, IconSave, IconSync } from '../components/glyphs'
import type { Translate } from '../lib/i18n'

/** The spots the pointer visits, as the card and a place in its picture's own 240 by 130 units. */
export const SCENE_STOPS: Record<string, [card: number, x: number, y: number]> = {
  gen: [0, 120, 26],
  copy: [0, 192, 114],
  enter: [1, 120, 26],
  paste: [1, 192, 114],
  hold: [2, 120, 80],
  done: [2, 168, 30],
}

/** Storage the first card offers. Names of services, so no language changes them. */
const STORAGE = ['Dropbox', 'OneDrive', 'Drive', 'pCloud', 'S3', 'SFTP', 'WebDAV', 'SMB']

/** When something on a card happens, as a share of the scene's loop. */
function at(share: number): CSSProperties {
  return { '--step-at': share } as CSSProperties
}

function Press({ x, y, width, height, rx, when }: { x: number; y: number; width: number; height: number; rx: number; when: number }) {
  return <rect className="al-scene-press" x={x} y={y} width={width} height={height} rx={rx} style={at(when)} />
}

/** A button of the app drawn small: a glyph in a filled square and its label. */
function Tile({ label, when }: { label: string; when: number }) {
  return (
    <>
      <rect className="al-scene-tile" x="8" y="8" width="224" height="38" rx="9" />
      <rect className="al-scene-seal al-scene-corner" x="14" y="14" width="26" height="26" rx="7" />
      <g transform="translate(19 19) scale(1.15)" className="al-scene-cut">
        <IconAdd />
      </g>
      {/* A long label is squeezed into the tile rather than run past it. */}
      <text className="al-scene-title" x="48" y="30.5" fontSize={11} {...(label.length > 28 ? { textLength: 176, lengthAdjust: 'spacingAndGlyphs' } : {})}>
        {label}
      </text>
      <Press x={8} y={8} width={224} height={38} rx={9} when={when} />
    </>
  )
}

function Button({ label, when }: { label: string; when: number }) {
  return (
    <>
      <rect className="al-scene-button" x="152" y="104" width="80" height="20" rx="10" />
      <g className="al-scene-face">
        <g transform="translate(160 109) scale(.71)">
          <IconSave />
        </g>
        <text x="174" y="117.5" fontSize={8.5}>
          {label}
        </text>
      </g>
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

/** One side of a job: a folder in a filled square and a line for its path. */
function Side({ x, y, when }: { x: number; y: number; when: number }) {
  return (
    <g className="al-scene-show-mid" style={at(when)}>
      <rect className="al-scene-seal al-scene-corner" x={x} y={y} width="22" height="22" rx="6" />
      <g transform={`translate(${x + 4} ${y + 4})`} className="al-scene-cut">
        <IconFolder />
      </g>
      <rect className="al-scene-path" x={x + 28} y={y + 8} width="48" height="6" rx="3" />
    </g>
  )
}

/** A folder at either end of the third card's sync. */
function Folder({ x }: { x: number }) {
  return (
    <>
      <rect className="al-scene-seal al-scene-corner" x={x} y="56" width="48" height="48" rx="12" />
      <g transform={`translate(${x + 10} ${66}) scale(2)`} className="al-scene-cut">
        <IconFolder />
      </g>
    </>
  )
}

/** The drawing on step card 1, 2 or 3. */
export function StepPicture({ step, t }: { step: 1 | 2 | 3; t: Translate }) {
  let body: ReactNode
  if (step === 1) {
    body = (
      <>
        <Tile label={t('targets.addStorage')} when={0.09} />
        {STORAGE.map((name, k) => {
          const x = 8 + (k % 4) * 58.67
          const y = 56 + Math.floor(k / 4) * 17
          return (
            <g key={name} className="al-scene-show-early" style={at(0.11 + k * 0.006)}>
              <rect className="al-scene-chip" x={x} y={y} width="50" height="13" rx="6.5" />
              <text className="al-scene-chip-text" x={x + 25} y={y + 9} fontSize={6.8} textAnchor="middle">
                {name}
              </text>
            </g>
          )
        })}
        <Button label={t('targets.save')} when={0.21} />
      </>
    )
  } else if (step === 2) {
    body = (
      <>
        <Tile label={t('edit.add')} when={0.43} />
        <rect className="al-scene-field" x="8" y="52" width="224" height="48" rx="9" />
        <rect className="al-scene-focus" x="8" y="52" width="224" height="48" rx="9" />
        <Side x={14} y={65} when={0.525} />
        <g className="al-scene-show-mid" style={at(0.53)}>
          <path className="al-scene-arrow" d="M98 76h18m-5-5 5 5-5 5" />
        </g>
        <Side x={126} y={65} when={0.535} />
        <Button label={t('edit.save')} when={0.51} />
      </>
    )
  } else {
    body = (
      <>
        <path className="al-scene-blocked" d="M76 80H164" />
        <path className="al-scene-link" d="M76 80H164" />
        <Folder x={28} />
        <Folder x={164} />
        <g transform="translate(120 80)">
          <g className="al-scene-lock">
            <circle className="al-scene-seal" r="10" />
            <g transform="translate(-7 -7)" className="al-scene-cut">
              <IconSync />
            </g>
          </g>
        </g>
        <g transform="translate(84 80)">
          <g className="al-scene-file">
            <rect className="al-scene-seal" x="-6" y="-8" width="12" height="16" rx="2" />
            <path className="al-scene-cut-line" d="M-3 -2h6M-3 1.5h6M-3 5h4" />
          </g>
        </g>
        <g transform="translate(120 22)">
          <circle className="al-scene-ring" r="14" />
          <g className="al-scene-badge">
            <g className="al-scene-badge-pop">
              <rect className="al-scene-badge-ground" x="-60" y="-13" width="120" height="26" rx="13" />
              <g transform="translate(-48 -6) scale(.86)" className="al-scene-badge-ink">
                <IconCheck />
              </g>
              <text className="al-scene-badge-text" x="7" y="4.5" fontSize={12} textAnchor="middle">
                {t('history.ok')}
              </text>
            </g>
          </g>
          {CONFETTI.map((flight, k) => (
            <g key={k} className="al-scene-confetti" style={flight}>
              <rect className={`al-scene-confetti-${k % 4}`} x="-2" y="-3.5" width="4" height="7" rx="1" />
            </g>
          ))}
        </g>
      </>
    )
  }
  return (
    <svg viewBox="0 0 240 130" aria-hidden="true" data-step={step} className="al-scene-pic">
      {body}
    </svg>
  )
}

/** The pointer that walks through the three cards. */
export function ScenePointer({ style }: { style: CSSProperties }) {
  return (
    <div className="al-scene-pointer" style={style} aria-hidden="true">
      <svg viewBox="0 0 14 19" width="14" height="19">
        <path className="al-scene-pointer-ink" d="M0 0v16l4.2-4 3 7 2.8-1.2-3-6.8H13z" />
      </svg>
    </div>
  )
}
