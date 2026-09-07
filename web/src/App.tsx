import { useCallback, useEffect, useState } from 'react'

import { Stack } from './components/Shell'
import { Card } from './lib/glimstone/Card'
import { Choice, Field } from './components/Field'
import { InfoBubble } from './lib/glimstone/InfoBubble'
import { ToggleRow } from './components/ToggleRow'
import { Selector } from './components/Selector'
import { Sidebar } from './components/Sidebar'
import { IconAbout, IconHistory, IconJobs, IconLook, IconReset, IconSettings, IconTargets } from './components/glyphs'
import { AccentSwatches, PaletteSwatches } from './components/Swatches'
import { About } from './components/About'
import { History, Jobs } from './pages/Jobs'
import { Preview } from './pages/Preview'
import { Targets } from './pages/Targets'
import { api, type Job, type Run, type RunEvent, type WindowSettings } from './lib/api'
import { ACCENTS, applyAccent, applyRainbow, applyShape, cacheAppearance, RAINBOW, rainbowState, type RainbowState, type Shape } from './lib/appearance'
import { CONTROL_AXES, getLabelMode, LABEL_MODES, setLabelMode, type ControlAxis, type LabelMode } from './lib/controls'
import { useT } from './lib/i18n'
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
        {/* Keyed on the tab, so React rebuilds this subtree when the tab
            changes and the entrance animation runs again. Without the key it
            plays once, on the first load, and never again: the element is the
            same element, only its contents changed, and an animation attached
            to an element that never re-mounts is an animation nobody sees.

            The class is GlimStone's own and the motion engine already dials it
            down or off; nothing here decides how long anything takes. This app
            had the engine and its three-way switch and, apart from the progress
            bar, nothing for it to act on. */}
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
      {/* The settings strip is CHIPS, not a groove.
          "die tabs sollen tabs sein, kein horizontaler selektor", reported
          twice. The first answer was that tabs and segmented controls are one
          component differing only in scale, so this strip was made bigger and
          left in the groove. That was wrong, and BombVault's own file says why:
          it has both shapes, arrived at through two separate rejections. Its
          small selectors were once given per-segment fills ("die nicht
          ausgewaehlten Optionen sollen kein Badge sein") and its settings tab
          strip was once given the groove. Two different controls, one
          implementation, and the difference is the TRACK, not the size.

          Which is also why "make the groove bigger" could never land: a strip
          in a groove reads as one control with a slot, whatever size it is. */}
      <Selector<SettingsSection>
        label={t('settings.section')}
        value={section}
        onChange={setSection}
        variant="chip"
        // Glyphs on every segment (jdp: "Glyphen fehlen"). This strip carried
        // none, on my own reasoning that two of the three sections had an
        // obvious mark and the third did not. That was the wrong way round:
        // BombVault's own settings strip gives every tab an icon, and "I could
        // not find a third glyph I liked" is a reason to go and find one, not a
        // reason to leave a whole strip out of the house pattern. The third one
        // exists, it is the information mark, and it is now in the generated
        // set beside the other nineteen.
        options={[
          { value: 'general', label: t('settings.general'), icon: <IconSettings /> },
          { value: 'look', label: t('settings.look'), icon: <IconLook /> },
          { value: 'about', label: t('settings.about'), icon: <IconAbout /> },
        ]}
      />
      {/* A reading width, not the window's width. Without it a label sat at the
          far left of the card and its control a thousand pixels away at the
          right, which is a large part of why this page did not read like the
          rest of the house.

          BombVault caps its own settings cards at the width of its tab strip,
          and copying that literally is the trap: its strip has seven tabs and
          this one has three, so the same rule produces a 230px column here and
          stacks every selector vertically. Measured that, saw it, and took the
          fixed width BombVault's own Settings.tsx uses elsewhere instead. Same
          number, and it does not depend on how many tabs a page happens to
          have. */}
      <div className="flex max-w-3xl flex-col gap-10">
        {section === 'general' ? (
          <General {...props} />
        ) : section === 'look' ? (
          <Look {...props} />
        ) : (
          <About version={props.version} />
        )}
      </div>
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
      <Card title={t('settings.general')} hueIndex={0}>
        <Field label={t('look.language')}>
          <Choice
            value={lang}
            onChange={onLang}
            label={t('look.language')}
            // The one picker on this page that is the point of its own card,
            // and the one carrying artwork rather than words alone. Sized to
            // match BombVault's language card, which is where the flags have
            // read correctly the longest.
            roomy
            options={languages.map((l) => ({
              value: l.code,
              label: l.label,
              // The flag is its own element now rather than two codepoints
              // glued to the front of the name. It has to be: an option in a
              // native list could hold nothing but text, and Windows draws that
              // text as a two-letter tag instead of a flag.
              flag: l.flag,
            }))}
          />
        </Field>
      </Card>

      {/* Left out entirely on a build with no window of its own, rather than
          shown inert. A switch that cannot do anything is worse than a missing
          one: it invites somebody to press it and then says nothing. */}
      {windowSettings && (
        <Card title={t('window.title')} hueIndex={1}>
          <div className="flex flex-col gap-3">
            <ToggleRow
              label={t('window.tray')}
              hint={t('window.trayHint')}
              checked={windowSettings.tray}
              onChange={(tray) => onWindow({ ...windowSettings, tray })}
            />
            {/* Both of these hang off the tray icon: without it, a window that
                hides has nothing left to bring it back. */}
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

      {/* A card of its own rather than a fourth switch in the one above, because
          this is not about the window. The three up there decide what a button
          on the frame does; this one decides whether the program is running at
          all before anybody has touched it, which is a different question and
          the one that makes a schedule worth setting.

          Gated on the system having a mechanism, not just on there being a
          window: a build on a platform with no autostart would otherwise draw a
          switch that reports false however it is pressed. */}
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
  languages: { code: string; label: string; flag: string }[]
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
      <Card title={t('look.theme')} hueIndex={0}>
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

      <Card title={t('look.corners')} hueIndex={1} hint={t('look.cornersHint')}>
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

      <Card title={t('look.motion')} hueIndex={2} hint={t('look.motionHint')}>
        <Selector<MotionIntensity>
          label={t('look.motion')}
          value={motion}
          onChange={onMotion}
          options={MOTION_INTENSITIES.map((m) => ({ value: m, label: t(motionKey[m]) }))}
        />
      </Card>

      <Card title={t('look.labels')} hueIndex={3} hint={t('look.labelsHint')}>
        <div className="flex flex-col gap-4">
          {/* All three surfaces now. The rail axis used to be filtered out
              because this app had no rail; it has one, so hiding the control
              would be hiding a setting that works. */}
          {CONTROL_AXES.map((axis) => (
            <div key={axis} className="flex flex-col gap-1">
              <span className="text-xs text-carbon-textSub">{t(axisKey[axis])}</span>
              <Selector<LabelMode>
                label={t(axisKey[axis])}
                value={labels[axis]}
                onChange={(next) => onLabels(axis, next)}
                options={LABEL_MODES.map((m) => ({ value: m, label: t(labelModeKey[m]) }))}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* ONE card for both, and it comes LAST, which is where BombVault puts it
          (jdp, about its own settings page: "Die card von Akzentfarbe und
          Regenbogenmodus in eine mergen. Gehört ja zusammen").

          They were two cards here, and that is the split BombVault already
          undid: the accent IS the rainbow's position zero, so a person changing
          one is looking at the other. Two cards made that one setting look like
          two unrelated ones, and put the palette a card away from the colour it
          starts with. */}
      <Card title={t('look.colors')} hueIndex={4}>
        <div className="flex flex-col gap-4">
          {/* Label left, controls hard right, the way every row in this house
              is built. The reset sits at the END of the row it resets, not in
              the card's action slot: it undoes THIS row, not the card. */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={`text-sm text-carbon-text${rainbow.on ? ' opacity-50' : ''}`}>
              {t('look.accent')}
            </span>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {/* Dimmed and inert while the rainbow is on. With the rainbow
                  running, the palette below hands out the colours by list
                  position and the accent is only its position zero, so picking
                  one here changes almost nothing anybody can see: a live
                  control whose effect has been taken away by another switch.
                  The palette row already had this treatment for the mirror
                  case, and now both say the same thing. */}
              <AccentSwatches
                presets={ACCENTS}
                value={accent}
                onChange={onAccent}
                disabled={rainbow.on}
              />
              <ResetBadge
                tip={t('look.accentReset')}
                disabled={rainbow.on || accent === DEFAULT_ACCENT}
                onClick={() => onAccent(DEFAULT_ACCENT)}
              />
            </div>
          </div>

          {/* Each row takes its OWN position in the palette. Three switches
              sharing one accent read as one setting with three parts; three
              colours read as three settings, which is what they are. */}
          <ToggleRow
            checked={rainbow.on}
            onChange={(on) => onRainbow({ ...rainbow, on })}
            label={t('look.rainbowOn')}
            hint={t('look.rainbowHint')}
            hueIndex={0}
          />
          {/* Both of these hang off the mode itself: reactive and rotate are
              instructions to a rainbow that is not running, so they are dimmed
              rather than left live and inert. */}
          <ToggleRow
            checked={rainbow.reactive}
            onChange={(reactive) => onRainbow({ ...rainbow, reactive })}
            label={t('look.rainbowReactive')}
            hint={t('look.reactiveHint')}
            disabled={!rainbow.on}
            hueIndex={1}
          />
          <ToggleRow
            checked={rainbow.rotate}
            onChange={(rotate) =>
              onRainbow({ ...rainbow, rotate, seed: rotate ? (rainbow.seed + 1) % 8 : 0 })
            }
            label={t('look.rainbowRotate')}
            hint={t('look.rotateHint')}
            disabled={!rainbow.on}
            hueIndex={2}
          />

          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm text-carbon-text">
              {t('look.palette')}
              <InfoBubble tip={t('look.paletteHint')} />
            </span>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {/* Every colour here is in force at once, so there is no selected
                  one and a click can only mean edit. */}
              <PaletteSwatches
                palette={rainbow.palette}
                disabled={!rainbow.on}
                onChange={(palette) => onRainbow({ ...rainbow, palette })}
              />
              <ResetBadge
                tip={t('look.paletteReset')}
                disabled={!rainbow.on || rainbow.palette.join() === RAINBOW.join()}
                onClick={() => onRainbow({ ...rainbow, palette: [...RAINBOW] })}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* About has its own section in the strip above, so it is not repeated at
          the bottom of this one. */}
    </Stack>
  )
}

/**
 * The reset at the end of a row of colour swatches.
 *
 * Always rendered, disabled when there is nothing to undo, never conditionally
 * unmounted. A control that appears only once it has work to do is a control
 * nobody knows about until the moment they have already made the mess, and a
 * row whose length changes as you use it is a row that moves under the pointer.
 *
 * Deliberately NOT in the colour engine, and this is the one exception in the
 * app. It sits inside the very row of colours it throws away, chrome-identical
 * to them: same box, same border, same radius. An accent or rainbow fill would
 * make it read as one more colour to pick, when clicking it discards the picked
 * colour instead. Same call and the same reasoning as BombVault's own two.
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
      title={tip}
      data-tip={tip}
      aria-label={tip}
      // The same 32px outer box as a swatch, reached the same way: a 2px border
      // around a 28px content area. Without the border the fill would reach the
      // full box edge to edge while every neighbouring disc is inset by its own
      // ring, so at an identical measured size it would still read as bigger.
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
