import { useCallback, useEffect, useState } from 'react'

import { Card, Stack } from './components/Shell'
import { Choice, Field, Info, Switch } from './components/Field'
import { Selector } from './components/Selector'
import { IconEdit, IconHistory, IconJobs, IconLook, IconTargets } from './components/glyphs'
import { AccentSwatches, PaletteSwatches } from './components/Swatches'
import { History, Jobs } from './pages/Jobs'
import { Preview } from './pages/Preview'
import { Editor } from './pages/Editor'
import { Targets } from './pages/Targets'
import { api, type Job, type Run, type RunEvent, type WindowSettings } from './lib/api'
import {
  ACCENTS,
  applyAccent,
  applyRainbow,
  applyShape,
  cacheAppearance,
  rainbowState,
  type RainbowState,
  type Shape,
} from './lib/appearance'
import { CONTROL_AXES, getLabelMode, LABEL_MODES, setLabelMode, type ControlAxis, type LabelMode } from './lib/controls'
import { languageFlag, useT } from './lib/i18n'
import { getMotion, MOTION_INTENSITIES, setMotion, type MotionIntensity } from './lib/motion'
import { wireTooltips } from './lib/tooltip'

type Tab = 'jobs' | 'edit' | 'targets' | 'history' | 'look'
type Theme = 'dark' | 'light'

const THEME_KEY = 'arrowloop.theme'

/**
 * The theme in use.
 *
 * There is deliberately no third "system" entry. That entry looks like an
 * option and is an excuse: it fails to answer the only question somebody opens
 * the list to ask, which is which theme is running right now, and it leaves the
 * control reading "system" on a page that is visibly dark. The device setting
 * is resolved here instead, and the real theme it lands on is what the control
 * shows as selected, until somebody chooses for themselves.
 */
function currentTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // Storage turned off. The device setting still answers.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: Theme, remember: boolean) {
  document.documentElement.setAttribute('data-theme', theme)
  if (!remember) return
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // A browser with storage disabled forgets the choice on reload.
  }
}

export function App() {
  const { t, lang, setLanguage, languages } = useT()
  const [tab, setTab] = useState<Tab>('jobs')
  const [jobs, setJobs] = useState<Job[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [progress, setProgress] = useState<Record<string, RunEvent>>({})
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [theme, setTheme] = useState<Theme>(currentTheme)
  const [shape, setShape] = useState<Shape>('round')
  const [accent, setAccent] = useState<string>(ACCENTS[0]?.hex ?? '#FCC419')
  const [rainbow, setRainbow] = useState<RainbowState>(rainbowState)
  const [motion, setMotionState] = useState<MotionIntensity>(getMotion)
  // Null until asked, and null for ever on a build with no window. The card is
  // left out entirely rather than shown inert.
  const [window_, setWindow] = useState<WindowSettings | null>(null)
  const [labels, setLabels] = useState<Record<ControlAxis, LabelMode>>(() => ({
    buttons: getLabelMode('buttons'),
    sidebar: getLabelMode('sidebar'),
    tabs: getLabelMode('tabs'),
  }))

  const refresh = useCallback(() => {
    api
      .jobs()
      .then(setJobs)
      .catch((e: Error) => setError(e.message))
    api
      .history(undefined, 50)
      .then(setRuns)
      .catch(() => {
        // A missing history is not worth an error banner over the whole page:
        // the job list is still useful without it.
      })
  }, [])

  useEffect(() => {
    void api.window().then(setWindow)
  }, [])

  useEffect(() => {
    wireTooltips()
    refresh()
    // Live events replace polling. A job going from waiting to running is the
    // one thing a person watches for, and asking again every second to catch it
    // is both slower and noisier than being told.
    return api.watch((ev) => {
      if (ev.phase === 'progress') {
        // A progress frame is the only kind that does not change the job list,
        // so it deliberately does not fetch it again. Ten thousand files would
        // otherwise mean ten thousand round trips for a list that says the same
        // thing every time.
        setProgress((prev) => ({ ...prev, [ev.job]: ev }))
        return
      }
      setProgress((prev) => {
        const next = { ...prev }
        delete next[ev.job]
        return next
      })
      refresh()
    })
  }, [refresh])

  // The device's own setting keeps applying until somebody picks a theme. After
  // that the choice holds, which is why the listener checks storage rather than
  // simply following the media query.
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!media) return
    const follow = () => {
      try {
        if (localStorage.getItem(THEME_KEY)) return
      } catch {
        // Nothing stored anywhere, so follow the device.
      }
      setTheme(media.matches ? 'light' : 'dark')
    }
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [])

  useEffect(() => applyTheme(theme, false), [theme])
  useEffect(() => {
    applyShape(shape)
    applyAccent(accent)
    cacheAppearance(shape, accent, rainbow)
  }, [shape, accent, rainbow])

  // The palette follows the accent when it is asked to, so a reactive rainbow
  // has to be rebuilt whenever the accent changes rather than only when one of
  // its own switches is touched.
  useEffect(() => {
    applyRainbow(rainbow)
  }, [rainbow])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        {/* One hero per page, and this is it: the mark and the wordmark, read as
            one thing. Everything else on the page is supporting detail at small
            type. The mark is sized against the wordmark beside it rather than by
            some ratio of the header, so neither one outshouts the other, and it
            carries no alt text on purpose: the name is already right next to it,
            and a screen reader should not announce it twice. */}
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" width={26} height={26} className="shrink-0" />
          <h1 className="text-[20px] font-semibold tracking-tight">
            Arrow<span className="text-accentInk">Loop</span>
          </h1>
        </div>
        <Selector<Tab>
          scale="small"
          label={t('nav.section')}
          value={previewing ? 'jobs' : tab}
          onChange={(next) => {
            setPreviewing(null)
            setTab(next)
          }}
          options={[
            { value: 'jobs', label: t('nav.jobs'), icon: <IconJobs /> },
            { value: 'edit', label: t('nav.edit'), icon: <IconEdit /> },
            { value: 'targets', label: t('nav.targets'), icon: <IconTargets /> },
            { value: 'history', label: t('nav.history'), icon: <IconHistory /> },
            { value: 'look', label: t('nav.look'), icon: <IconLook /> },
          ]}
        />
      </header>

      {error && (
        <Card title={t('error.unreachable')} hue={0}>
          <p className="text-[12px] text-statusFail">{error}</p>
        </Card>
      )}

      {previewing ? (
        <Preview
          job={previewing}
          onDone={() => {
            setPreviewing(null)
            refresh()
          }}
        />
      ) : tab === 'jobs' ? (
        <Jobs jobs={jobs} progress={progress} onPreview={setPreviewing} />
      ) : tab === 'edit' ? (
        <Editor onSaved={refresh} />
      ) : tab === 'targets' ? (
        <Targets />
      ) : tab === 'history' ? (
        <History runs={runs} />
      ) : (
        <Look
          theme={theme}
          onTheme={(next) => {
            setTheme(next)
            applyTheme(next, true)
          }}
          shape={shape}
          onShape={setShape}
          accent={accent}
          onAccent={setAccent}
          rainbow={rainbow}
          onRainbow={setRainbow}
          motion={motion}
          onMotion={(next) => {
            setMotion(next)
            setMotionState(next)
          }}
          labels={labels}
          onLabels={(axis, next) => {
            setLabelMode(axis, next)
            setLabels((prev) => ({ ...prev, [axis]: next }))
          }}
          window={window_}
          onWindow={(next) => {
            setWindow(next)
            void api.saveWindow(next).then(setWindow)
          }}
          lang={lang}
          onLang={setLanguage}
          languages={languages}
        />
      )}
    </div>
  )
}

/**
 * The looks a person owns.
 *
 * Every card here carries its own palette position, so turning the rainbow on
 * colours this page as it colours every other one. A settings page that edits a
 * mode without showing it is asking somebody to change a value and then go
 * elsewhere to find out what they did.
 */
function Look({
  theme,
  onTheme,
  shape,
  onShape,
  accent,
  onAccent,
  rainbow,
  onRainbow,
  motion,
  onMotion,
  labels,
  onLabels,
  window: windowSettings,
  onWindow,
  lang,
  onLang,
  languages,
}: {
  theme: Theme
  onTheme: (next: Theme) => void
  shape: Shape
  onShape: (next: Shape) => void
  accent: string
  onAccent: (next: string) => void
  rainbow: RainbowState
  onRainbow: (next: RainbowState) => void
  motion: MotionIntensity
  onMotion: (next: MotionIntensity) => void
  labels: Record<ControlAxis, LabelMode>
  onLabels: (axis: ControlAxis, next: LabelMode) => void
  window: WindowSettings | null
  onWindow: (next: WindowSettings) => void
  lang: string
  onLang: (next: string) => void
  languages: { code: string; label: string }[]
}) {
  const { t } = useT()
  return (
    <Stack>
      <Card title={t('look.language')} hue={0}>
        <Field label={t('look.language')}>
          <Choice
            value={lang}
            onChange={onLang}
            label={t('look.language')}
            options={languages.map((l) => ({
              value: l.code,
              // The flag is part of the label rather than a separate column,
              // because a native list can only ever hold text. Windows renders
              // the same codepoints as a two-letter tag instead of a flag,
              // which is its own font policy and still readable.
              label: `${languageFlag(l.code)} ${l.label}`.trim(),
            }))}
          />
        </Field>
      </Card>

      <Card title={t('look.theme')} hue={1}>
        <Selector<Theme>
          label={t('look.theme')}
          value={theme}
          onChange={onTheme}
          options={[
            { value: 'dark', label: t('look.dark') },
            { value: 'light', label: t('look.light') },
          ]}
        />
      </Card>

      <Card title={t('look.corners')} hue={2}>
        <Selector<Shape>
          label={t('look.corners')}
          value={shape}
          onChange={onShape}
          options={[
            { value: 'round', label: t('look.round') },
            { value: 'soft', label: t('look.soft') },
            { value: 'square', label: t('look.square') },
          ]}
        />
      </Card>

      <Card title={t('look.accent')} hue={3}>
        <AccentSwatches presets={ACCENTS} value={accent} onChange={onAccent} />
      </Card>

      <Card
        title={t('look.rainbow')}
        hue={4}
        actions={<Info text={t('look.rainbowHint')} />}
      >
        <div className="flex flex-col gap-3">
          <Switch
            on={rainbow.on}
            onChange={(on) => onRainbow({ ...rainbow, on })}
            label={t('look.rainbowOn')}
            hint={t('look.rainbowHint')}
          />
          <Switch
            on={rainbow.reactive}
            onChange={(reactive) => onRainbow({ ...rainbow, reactive })}
            label={t('look.rainbowReactive')}
            hint={t('look.reactiveHint')}
          />
          <Switch
            on={rainbow.rotate}
            onChange={(rotate) =>
              onRainbow({ ...rainbow, rotate, seed: rotate ? (rainbow.seed + 1) % 8 : 0 })
            }
            label={t('look.rainbowRotate')}
            hint={t('look.rotateHint')}
          />
          <div className="mt-1">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-carbon-textMuted">
              {t('look.palette')}
              <Info text={t('look.paletteHint')} />
            </p>
            {/* Every colour here is in force at once, so there is no selected
                one to click twice and a click can only mean edit. */}
            <PaletteSwatches
              palette={rainbow.palette}
              onChange={(palette) => onRainbow({ ...rainbow, palette })}
            />
          </div>
        </div>
      </Card>

      <Card title={t('look.motion')} hue={5} actions={<Info text={t('look.motionHint')} />}>
        <Selector<MotionIntensity>
          label={t('look.motion')}
          value={motion}
          onChange={onMotion}
          options={MOTION_INTENSITIES.map((m) => ({ value: m, label: t(motionKey[m]) }))}
        />
      </Card>

      {windowSettings && (
        <Card title={t('window.title')} hue={6}>
          <div className="flex flex-col gap-3">
            <Switch
              on={windowSettings.tray}
              onChange={(tray) => onWindow({ ...windowSettings, tray })}
              label={t('window.tray')}
              hint={t('window.trayHint')}
            />
            {/* The two below have nowhere to send the window without the icon,
                so they go with it rather than staying on as a promise the
                program cannot keep. */}
            <Switch
              on={windowSettings.closeToTray}
              onChange={(closeToTray) => onWindow({ ...windowSettings, closeToTray })}
              label={t('window.close')}
              hint={t('window.closeHint')}
            />
            <Switch
              on={windowSettings.minimiseToTray}
              onChange={(minimiseToTray) => onWindow({ ...windowSettings, minimiseToTray })}
              label={t('window.minimise')}
              hint={t('window.minimiseHint')}
            />
          </div>
        </Card>
      )}

      <Card title={t('look.labels')} hue={7} actions={<Info text={t('look.labelsHint')} />}>
        <div className="flex flex-col gap-4">
          {/* Two surfaces, not three. The engine carries a rail axis as well and
              this app has no rail, so offering a third control would be offering
              one that does nothing. */}
          {CONTROL_AXES.filter((axis) => axis !== 'sidebar').map((axis) => (
            <Field key={axis} label={t(axisKey[axis])}>
              <Selector<LabelMode>
                label={t(axisKey[axis])}
                value={labels[axis]}
                onChange={(next) => onLabels(axis, next)}
                options={LABEL_MODES.map((m) => ({ value: m, label: t(labelModeKey[m]) }))}
              />
            </Field>
          ))}
        </div>
      </Card>
    </Stack>
  )
}

const motionKey = {
  off: 'look.motionOff',
  subtle: 'look.motionSubtle',
  full: 'look.motionFull',
} as const

const axisKey = {
  buttons: 'look.labelsButtons',
  sidebar: 'look.labelsSidebar',
  tabs: 'look.labelsTabs',
} as const

const labelModeKey = {
  text: 'look.labelText',
  textGlyph: 'look.labelTextGlyph',
  glyph: 'look.labelGlyph',
  reactive: 'look.labelReactive',
} as const
