import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Stack } from './components/Shell'
import { Card } from './lib/glimstone/Card'
import { Button } from './lib/glimstone/Button'
import { Choice, Field } from './components/Field'
import { InfoBubble } from './lib/glimstone/InfoBubble'
import { ToggleRow } from './components/ToggleRow'
import { HUE_OFFSET, Selector } from './components/Selector'
import { Sidebar } from './components/Sidebar'
import { IconHistory, IconJobs, IconLive, IconLock, IconLook, IconPhone, IconReset, IconSettings, IconTargets } from './components/glyphs'
import { AccentSwatches, PaletteSwatches } from './components/Swatches'
import { About } from './components/About'
import { SettingsBackup } from './components/SettingsBackup'
import { Login } from './pages/Login'
import { Apps } from './pages/Apps'
import { Engine } from './pages/Engine'
import { History, Jobs } from './pages/Jobs'
import { Preview } from './pages/Preview'
import { Security } from './pages/Security'
import { Targets } from './pages/Targets'
import { api, type Job, type Run, type RunEvent, type Volume, type WindowSettings } from './lib/api'
import { Places } from './lib/places'
import { ACCENTS, applyAccent, applyRainbow, applyShape, cacheAppearance, RAINBOW, rainbowState, type RainbowState, type Shape } from './lib/appearance'
import { storedLook, storedSlots, storeSlots } from './lib/look'
import { applyDisco, discoTap } from './lib/disco'
import { getDisco, setDisco } from './lib/discoSetting'
import { CONTROL_AXES, getLabelMode, LABEL_MODES, setLabelMode, type ControlAxis, type LabelMode } from './lib/controls'
import { useT } from './lib/i18n'
import { getMotion, MOTION_INTENSITIES, setMotion, type MotionIntensity } from './lib/motion'
import { wireTooltips } from './lib/tooltip'

/** The app's places, in the order the sibling apps use, settings last. */
type Tab = 'jobs' | 'targets' | 'history' | 'settings'

/** Settings is one tab with sections, the same shape BombVault uses. */
type SettingsSection = 'general' | 'engine' | 'look' | 'app' | 'security'

type Theme = 'dark' | 'light'

/** The house accent a reset returns to, the first preset. */
const DEFAULT_ACCENT = ACCENTS[0]?.hex ?? '#FCC419'
const presetHexes = ACCENTS.map((a) => a.hex)

const THEME_KEY = 'arrowloop.theme'

/**
 * The theme in use. There is no "system" choice: the device setting resolves
 * to the real theme, which the control shows until somebody picks one.
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

/**
 * The login gate. App mounts only once there is a session, since its fetches
 * and event stream would all answer 401 on a protected install.
 */
export function Gate() {
  const [state, setState] = useState<'asking' | 'in' | 'out'>('asking')

  const ask = useCallback(() => {
    api
      .session()
      .then((s) => setState(s.required && !s.authenticated ? 'out' : 'in'))
      .catch(() => {
        // An unreachable engine is no password problem; App shows its own
        // banner for it.
        setState('in')
      })
  }, [])

  useEffect(ask, [ask])

  if (state === 'asking') return null
  if (state === 'out') return <Login onIn={ask} />
  return <App />
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
  const [shape, setShape] = useState<Shape>(() => storedLook().shape ?? 'round')
  const [accent, setAccent] = useState<string>(() => storedLook().accent ?? DEFAULT_ACCENT)
  const [slots, setSlots] = useState(() => storedSlots(presetHexes))
  const [rainbow, setRainbow] = useState<RainbowState>(rainbowState)
  const [motion, setMotionState] = useState<MotionIntensity>(getMotion)
  const [disco, setDiscoState] = useState(getDisco)
  // Only for naming a drive in the file log, so a failed fetch leaves the id.
  const [drives, setDrives] = useState<Volume[]>([])
  const places = useMemo(() => ({ jobs, drives }), [jobs, drives])
  // Null until asked, and always on a build with no window of its own.
  const [window_, setWindow] = useState<WindowSettings | null>(null)
  const [version, setVersion] = useState('dev')
  const [canSecure, setCanSecure] = useState(false)
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
      .history(undefined, 'all', 50)
      .then(setRuns)
      .catch(() => {
        // The job list is still useful without the history.
      })
  }, [])

  useEffect(() => {
    void api
      .volumes()
      .then((v) => setDrives(v.volumes))
      .catch(() => {})
    void api.capabilities().then((can) => {
      setVersion(can.version || 'dev')
      setCanSecure(can.security === true)
      if (can.window) void api.window().then(setWindow)
    })
  }, [])

  useEffect(() => {
    wireTooltips()
    refresh()
    return api.watch((ev) => {
      // "moving" frames arrive twice a second during a run and change nothing
      // drawn here; falling through would refetch the job list each time.
      if (ev.phase === 'moving') return
      if (ev.phase === 'progress') {
        // Progress does not change the job list, so it is not refetched.
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

  // The device setting applies until somebody picks a theme.
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!media) return
    const follow = () => {
      try {
        if (localStorage.getItem(THEME_KEY)) return
      } catch {
        // Without storage nothing was picked, so follow the device.
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

  useEffect(() => {
    applyRainbow(rainbow)
  }, [rainbow])

  // After the rainbow, which writes the resting colours the walk starts from.
  useEffect(() => {
    applyDisco(disco)
  }, [disco, rainbow])

  const running = jobs.filter((j) => j.running).length

  return (
    // A fixed rail and a page that scrolls beside it. The gutter padding lets
    // the rail float as a card on the ground.
    <div className="flex h-screen gap-4 overflow-hidden bg-carbon-background p-[var(--page-gutter)]">
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

      <Places.Provider value={places}>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {/* Keyed on the tab, so the subtree remounts and GlimStone's entrance
            animation plays on every tab change. */}
        <div
          key={previewing ? `preview:${previewing}` : tab}
          className="glim-page-enter flex min-h-full w-full flex-col gap-8 p-6 md:p-8"
        >
          {error && (
            <Card title={t('error.unreachable')} hueIndex={0}>
              <p className="text-xs text-statusFail">{error}</p>
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
            <Jobs jobs={jobs} runs={runs} progress={progress} onPreview={setPreviewing} onSaved={refresh} />
          ) : tab === 'targets' ? (
            <Targets />
          ) : tab === 'history' ? (
            // The log is the whole page, so its card reaches the bottom of the
            // window however few lines it has.
            <div className="flex flex-1 flex-col *:flex-1">
              <History runs={runs} jobs={jobs} onChanged={refresh} />
            </div>
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
          slots={slots}
          onSlots={(next) => {
            setSlots(next)
            storeSlots(next)
          }}
          rainbow={rainbow}
          onRainbow={setRainbow}
          disco={disco}
          onDisco={(on) => {
            setDisco(on)
            setDiscoState(on)
          }}
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
          security={canSecure}
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
      </Places.Provider>
    </div>
  )
}

/**
 * Settings: one tab with general, engine and appearance sections. Every card
 * carries its own palette position, so the rainbow shows on this page too.
 */
function Settings(props: LookProps) {
  const { t } = useT()
  const [section, setSection] = useState<SettingsSection>('general')

  return (
    <Stack>
      {/* Chips rather than a groove: a settings strip is tabs, not a
          segmented control. */}
      <div className="max-w-4xl">
      <Selector<SettingsSection>
        label={t('settings.section')}
        hueOffset={HUE_OFFSET.tabs}
        value={section}
        onChange={setSection}
        variant="chip"
        fill
        options={[
          { value: 'general', label: t('settings.general'), icon: <IconSettings /> },
          { value: 'engine', label: t('settings.engine'), icon: <IconLive /> },
          { value: 'look', label: t('settings.look'), icon: <IconLook /> },
          { value: 'app', label: t('settings.app'), icon: <IconPhone /> },
          // Left out where the interface cannot keep a password of its own.
          ...(props.security
            ? [{ value: 'security' as SettingsSection, label: t('settings.security'), icon: <IconLock /> }]
            : []),
        ]}
      />
      </div>
      {/* A reading width that the strip above shares, so cards and tabs line
          up without the column depending on the length of the tab labels. */}
      <div className="flex max-w-4xl flex-col gap-10">
        {section === 'general' ? (
          <General {...props} />
        ) : section === 'engine' ? (
          <Engine />
        ) : section === 'app' ? (
          <Apps />
        ) : section === 'security' ? (
          <Security />
        ) : (
          <Look {...props} />
        )}
      </div>
    </Stack>
  )
}

/** The log-out row, drawn only on an install that has a password. */
function LogOut() {
  const { t } = useT()
  const [required, setRequired] = useState(false)

  useEffect(() => {
    api
      .session()
      .then((s) => setRequired(s.required))
      .catch(() => setRequired(false))
  }, [])

  if (!required) return null
  return (
    <div className="flex justify-end">
      <Button
        label={t('login.logout')}
        labelKey="login.logout"
        onClick={() => {
          // A reload, so nothing fetched with the old session stays on screen.
          void api.logout().finally(() => window.location.reload())
        }}
      />
    </div>
  )
}

/** The settings that are not about looks: language, backup, window, About. */
function General({
  lang,
  onLang,
  languages,
  window: windowSettings,
  onWindow,
  version,
}: LookProps) {
  const { t } = useT()
  return (
    <Stack>
      {/* Named for the section rather than the field, so the word does not
          print twice. */}
      <Card title={t('settings.general')} hueIndex={0}>
        <Field label={t('look.language')}>
          <Choice
            value={lang}
            onChange={onLang}
            label={t('look.language')}
            roomy
            options={languages.map((l) => ({
              value: l.code,
              label: l.label,
              flag: l.flag,
            }))}
          />
        </Field>
      </Card>

      <LogOut />

      <SettingsBackup hueIndex={1} />

      {/* Left out rather than shown inert on a build with no window. */}
      {windowSettings && (
        <Card title={t('window.title')} hueIndex={2}>
          <div className="flex flex-col gap-3">
            <ToggleRow
              label={t('window.tray')}
              hint={t('window.trayHint')}
              checked={windowSettings.tray}
              onChange={(tray) => onWindow({ ...windowSettings, tray })}
            />
            {/* Both rely on the tray icon to bring a hidden window back. */}
            <ToggleRow
              label={t('window.close')}
              hint={t('window.closeHint')}
              checked={windowSettings.closeToTray}
              onChange={(closeToTray) => onWindow({ ...windowSettings, closeToTray })}
            />
            <ToggleRow
              label={t('window.minimise')}
              hint={t('window.minimiseHint')}
              checked={windowSettings.minimiseToTray}
              onChange={(minimiseToTray) => onWindow({ ...windowSettings, minimiseToTray })}
            />
          </div>
        </Card>
      )}

      {/* Gated on the platform having an autostart mechanism, or the switch
          would report false however it is pressed. */}
      {windowSettings?.canStartWithSystem && (
        <Card title={t('start.title')} hueIndex={2}>
          <ToggleRow
            label={t('start.withSystem')}
            hint={t('start.withSystemHint')}
            checked={windowSettings.startWithSystem}
            onChange={(startWithSystem) => onWindow({ ...windowSettings, startWithSystem })}
          />
        </Card>
      )}

      <About version={version} />
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
  /** The colour each accent swatch holds. */
  slots: string[]
  onSlots: (next: string[]) => void
  rainbow: RainbowState
  onRainbow: (next: RainbowState) => void
  disco: boolean
  onDisco: (on: boolean) => void
  motion: MotionIntensity
  onMotion: (next: MotionIntensity) => void
  labels: Record<ControlAxis, LabelMode>
  onLabels: (axis: ControlAxis, next: LabelMode) => void
  version: string
  /** Whether this build keeps a password, a second factor and passkeys. */
  security: boolean
  window: WindowSettings | null
  onWindow: (next: WindowSettings) => void
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
function Look({
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
}: LookProps) {
  const { t } = useT()
  const storm = useStormUnlock(motion, onMotion)
  const discoUnlock = useDiscoUnlock(disco, onDisco)
  return (
    <Stack>
      <Card title={t('look.theme')} hueIndex={0}>
        <Selector<Theme>
          label={t('look.theme')}
          hueOffset={HUE_OFFSET.theme}
          value={theme}
          onChange={onTheme}
          options={[
            { value: 'dark', label: t('look.dark') },
            { value: 'light', label: t('look.light') },
          ]}
        />
      </Card>

      <Card title={t('look.corners')} hueIndex={1} hint={t('look.cornersHint')}>
        <Selector<Shape>
          label={t('look.corners')}
          hueOffset={HUE_OFFSET.shape}
          value={shape}
          onChange={onShape}
          options={[
            { value: 'round', label: t('look.round') },
            { value: 'soft', label: t('look.soft') },
            { value: 'square', label: t('look.square') },
          ]}
        />
      </Card>

      <Card title={t('look.motion')} hueIndex={2} hint={t('look.motionHint')}>
        <Selector<MotionIntensity>
          label={t('look.motion')}
          hueOffset={HUE_OFFSET.motion}
          value={motion}
          onChange={(next) => {
            onMotion(next)
            storm.click(next)
          }}
          options={[
            ...MOTION_INTENSITIES.map((m) => ({ value: m, label: t(motionKey[m]) })),
            ...(storm.offered ? [{ value: 'storm' as MotionIntensity, label: t(motionKey.storm) }] : []),
          ]}
        />
      </Card>

      <Card title={t('look.labels')} hueIndex={3} hint={t('look.labelsHint')}>
        <div className="flex flex-col gap-4">
          {CONTROL_AXES.map((axis, row) => (
            <div key={axis} className="flex flex-col gap-1">
              <span className="text-xs text-carbon-textSub">{t(axisKey[axis])}</span>
              <Selector<LabelMode>
                label={t(axisKey[axis])}
                hueOffset={HUE_OFFSET.labels + row}
                value={labels[axis]}
                onChange={(next) => onLabels(axis, next)}
                options={LABEL_MODES.map((m) => ({ value: m, label: t(labelModeKey[m]) }))}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Accent and rainbow share one card, last, as in BombVault: the accent
          is the rainbow's position zero. */}
      <Card title={t('look.colors')} hueIndex={4}>
        <div className="flex flex-col gap-4">
          {/* The reset belongs to this row rather than to the card's action
              slot: it resets only the accent. */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-sm text-carbon-text${rainbow.on ? ' opacity-50' : ''}`}>
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
                disabled={rainbow.on || (accent === DEFAULT_ACCENT && slots.join() === presetHexes.join())}
                onClick={() => {
                  onAccent(DEFAULT_ACCENT)
                  onSlots(presetHexes)
                }}
              />
            </div>
          </div>

          <ToggleRow
            checked={rainbow.on}
            onChange={(on) => {
              onRainbow({ ...rainbow, on })
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
                onChange={(reactive) => onRainbow({ ...rainbow, reactive })}
                label={t('look.rainbowReactive')}
                hint={t('look.reactiveHint')}
                hueIndex={1}
              />
              <ToggleRow
                checked={rainbow.rotate}
                onChange={(rotate) =>
                  onRainbow({ ...rainbow, rotate, seed: rotate ? (rainbow.seed + 1) % 8 : 0 })
                }
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
            </>
          )}

          {rainbow.on && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm text-carbon-text">
                {t('look.palette')}
                <InfoBubble tip={t('look.paletteHint')} />
              </span>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <PaletteSwatches
                  palette={rainbow.palette}
                  onChange={(palette) => onRainbow({ ...rainbow, palette })}
                />
                <ResetBadge
                  tip={t('look.paletteReset')}
                  disabled={rainbow.palette.join() === RAINBOW.join()}
                  onClick={() => onRainbow({ ...rainbow, palette: [...RAINBOW] })}
                />
              </div>
            </div>
          )}
        </div>
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
function ResetBadge({
  tip,
  onClick,
  disabled,
}: {
  tip: string
  onClick: () => void
  disabled?: boolean
}) {
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
        borderRadius: 'var(--radius-control)',
        border: '2px solid var(--carbon-border)',
      }}
    >
      <IconReset />
    </button>
  )
}

const motionKey = {
  off: 'look.motionOff',
  subtle: 'look.motionSubtle',
  wild: 'look.motionWild',
  storm: 'look.motionStorm',
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
