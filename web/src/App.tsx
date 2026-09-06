import { useCallback, useEffect, useState } from 'react'

import { Card, IconButton, Stack } from './components/Shell'
import { Choice, Field, Info, Switch } from './components/Field'
import { Selector } from './components/Selector'
import { Sidebar } from './components/Sidebar'
import { IconHistory, IconJobs, IconReset, IconSettings, IconTargets } from './components/glyphs'
import { AccentSwatches, PaletteSwatches } from './components/Swatches'
import { About } from './components/About'
import { History, Jobs } from './pages/Jobs'
import { Preview } from './pages/Preview'
import { Targets } from './pages/Targets'
import { api, type Job, type Run, type RunEvent, type WindowSettings } from './lib/api'
import {
  ACCENTS,
  applyAccent,
  applyRainbow,
  applyShape,
  cacheAppearance,
  RAINBOW,
  rainbowState,
  type RainbowState,
  type Shape,
} from './lib/appearance'
import { CONTROL_AXES, getLabelMode, LABEL_MODES, setLabelMode, type ControlAxis, type LabelMode } from './lib/controls'
import { languageFlag, useT } from './lib/i18n'
import { getMotion, MOTION_INTENSITIES, setMotion, type MotionIntensity } from './lib/motion'
import { wireTooltips } from './lib/tooltip'

/**
 * The four places this app has, in the order every other program in this house
 * puts them: the thing you came for, the things it points at, what it did, and
 * settings last.
 *
 * There is no separate editing tab any more. A job was created on one tab and
 * watched on another, which meant the plus button and the list it added to were
 * never on screen together, and every edit began by finding the same job twice.
 */
type Tab = 'jobs' | 'targets' | 'history' | 'settings'

/** Settings is one tab with sections, the same shape BombVault uses. */
type SettingsSection = 'general' | 'look' | 'about'

type Theme = 'dark' | 'light'

/**
 * The house accent, and the one a reset returns to.
 *
 * Read from the preset list rather than written out again, so the swatch that
 * is offered first and the colour the button restores can never disagree.
 */
const DEFAULT_ACCENT = ACCENTS[0]?.hex ?? '#FCC419'

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
  const [version, setVersion] = useState('dev')
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
    void api.capabilities().then((can) => {
      setVersion(can.version || 'dev')
      if (can.window) void api.window().then(setWindow)
    })
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

  // The rail carries the number of jobs working right now, because that is the
  // one fact somebody watches for without going and looking.
  const running = jobs.filter((j) => j.running).length

  return (
    // The house frame: a fixed rail, and a page that scrolls beside it. The
    // window is the height, not the content, so the rail never scrolls away
    // from under the pointer.
    <div className="flex h-screen overflow-hidden bg-carbon-background">
      <Sidebar<Tab>
        value={previewing ? 'jobs' : tab}
        mode={labels.sidebar}
        onChange={(next) => {
          setPreviewing(null)
          setTab(next)
        }}
        items={[
          { value: 'jobs', label: t('nav.jobs'), icon: <IconJobs />, badge: running },
          { value: 'targets', label: t('nav.targets'), icon: <IconTargets /> },
          { value: 'history', label: t('nav.history'), icon: <IconHistory /> },
        ]}
        settings={{ value: 'settings', label: t('nav.settings'), icon: <IconSettings /> }}
      />

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full w-full flex-col gap-8 p-6 md:p-8">
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
            <Jobs jobs={jobs} progress={progress} onPreview={setPreviewing} onSaved={refresh} />
          ) : tab === 'targets' ? (
            <Targets />
          ) : tab === 'history' ? (
            <History runs={runs} />
          ) : (
            <Settings
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
          version={version}
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
      </main>
    </div>
  )
}

/**
 * Settings: one tab, three sections behind a strip of its own.
 *
 * The sections exist because a single column holding language, theme, corner
 * shape, accent, palette, motion, four label axes, the window buttons and the
 * versions is a page somebody scrolls rather than reads. Splitting it the way
 * every other program here splits it, general first and appearance second, puts
 * each answer where somebody would go looking for it.
 *
 * Every card carries its own palette position, so turning the rainbow on
 * colours this page as it colours every other one. A settings page that edits a
 * mode without showing it is asking somebody to change a value and then go
 * elsewhere to find out what they did.
 */
function Settings(props: LookProps) {
  const { t } = useT()
  const [section, setSection] = useState<SettingsSection>('general')

  return (
    <Stack>
      <Selector<SettingsSection>
        scale="small"
        label={t('settings.section')}
        value={section}
        onChange={setSection}
        // No glyphs on this strip. Two of the three sections have an obvious
        // mark and the third does not, and a strip where one segment wears a
        // borrowed icon reads worse than one that wears none.
        options={[
          { value: 'general', label: t('settings.general') },
          { value: 'look', label: t('settings.look') },
          { value: 'about', label: t('settings.about') },
        ]}
      />
      {section === 'general' ? (
        <General {...props} />
      ) : section === 'look' ? (
        <Look {...props} />
      ) : (
        <About version={props.version} />
      )}
    </Stack>
  )
}

/**
 * The settings that are not about how the app looks: what language it speaks,
 * and what its own window does when a button on it is pressed.
 */
function General({ lang, onLang, languages, window: windowSettings, onWindow }: LookProps) {
  const { t } = useT()
  return (
    <Stack>
      {/* The card is named for the section, the field for the setting. Naming
          both after the same thing prints the word twice, forty pixels apart,
          which is the shape BombVault had to unpick three separate times. */}
      <Card title={t('settings.general')} hue={0}>
        <Field label={t('look.language')}>
          <Choice
            value={lang}
            onChange={onLang}
            label={t('look.language')}
            options={languages.map((l) => ({
              value: l.code,
              label: `${languageFlag(l.code)} ${l.label}`,
            }))}
          />
        </Field>
      </Card>

      {/* Left out entirely on a build with no window of its own, rather than
          shown inert. A switch that cannot do anything is worse than a missing
          one: it invites somebody to press it and then says nothing. */}
      {windowSettings && (
        <Card title={t('window.title')} hue={1}>
          <div className="flex flex-col gap-3">
            <Switch
              label={t('window.tray')}
              hint={t('window.trayHint')}
              on={windowSettings.tray}
              onChange={(tray) => onWindow({ ...windowSettings, tray })}
            />
            {/* Both of these hang off the tray icon: without it, a window that
                hides has nothing left to bring it back. */}
            <Switch
              label={t('window.close')}
              hint={t('window.closeHint')}
              on={windowSettings.closeToTray}
              onChange={(closeToTray) => onWindow({ ...windowSettings, closeToTray })}
            />
            <Switch
              label={t('window.minimise')}
              hint={t('window.minimiseHint')}
              on={windowSettings.minimiseToTray}
              onChange={(minimiseToTray) => onWindow({ ...windowSettings, minimiseToTray })}
            />
          </div>
        </Card>
      )}
    </Stack>
  )
}

interface LookProps {
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
  version: string
  window: WindowSettings | null
  onWindow: (next: WindowSettings) => void
  lang: string
  onLang: (next: string) => void
  languages: { code: string; label: string }[]
}

/** The looks a person owns. */
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
}: LookProps) {
  const { t } = useT()
  return (
    <Stack>
      {/* The language lives under General now, not here. It decides what the
          app SAYS, not how it looks, and it sat at the top of this page only
          because this page used to be the only settings page there was. */}
      <Card title={t('look.theme')} hue={0}>
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

      {/* The way back is part of the control, not a thing to look up. A colour
          somebody mixed themselves has no swatch to click to undo it, so
          without this the only route back to the house colour is knowing its
          hex, which nobody does. */}
      <Card
        title={t('look.accent')}
        hue={3}
        actions={
          accent !== DEFAULT_ACCENT ? (
            // A glyph, not the word. A small single-purpose reset badge with a
            // text label reads as a stray caption beside the icon-only controls
            // around it, and spends row width on a word the tip already says.
            <IconButton title={t('look.accentReset')} onClick={() => onAccent(DEFAULT_ACCENT)}>
              <IconReset />
            </IconButton>
          ) : undefined
        }
      >
        <AccentSwatches presets={ACCENTS} value={accent} onChange={onAccent} />
      </Card>

      <Card title={t('look.rainbow')} hue={4} hint={t('look.rainbowHint')}>
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
              {/* Eight colours somebody mixed themselves have eight ways to be
                  wrong and no way back, because there is no swatch to click to
                  undo one. The way back belongs next to the thing it undoes. */}
              {rainbow.palette.join() !== RAINBOW.join() && (
                // Was an underlined text link, which is the one thing rule 13
                // names outright: a plain link between badges is a foreign
                // object. Same badge as every other small action here.
                <IconButton
                  title={t('look.paletteReset')}
                  onClick={() => onRainbow({ ...rainbow, palette: [...RAINBOW] })}
                >
                  <IconReset />
                </IconButton>
              )}
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

      <Card title={t('look.motion')} hue={5} hint={t('look.motionHint')}>
        <Selector<MotionIntensity>
          label={t('look.motion')}
          value={motion}
          onChange={onMotion}
          options={MOTION_INTENSITIES.map((m) => ({ value: m, label: t(motionKey[m]) }))}
        />
      </Card>

      {/* The window switches moved to General with the language: what the close
          button does is not a matter of appearance. */}

      <Card title={t('look.labels')} hue={6} hint={t('look.labelsHint')}>
        <div className="flex flex-col gap-4">
          {/* All three surfaces now. The rail axis used to be filtered out
              because this app had no rail; it has one, so hiding the control
              would be hiding a setting that works. */}
          {CONTROL_AXES.map((axis) => (
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

      {/* About has its own section in the strip above, so it is not repeated at
          the bottom of this one. */}
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
