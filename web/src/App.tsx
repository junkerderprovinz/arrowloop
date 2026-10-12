import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import { BottomBar } from './components/BottomBar'
import { Sidebar } from './components/Sidebar'
import { WhatsNewDots } from './components/WhatsNewDots'
import { Card } from './lib/glimstone/Card'
import { Login } from './pages/Login'
import { Activity } from './pages/Activity'
import { Anomalies } from './pages/Anomalies'
import { Conflicts } from './pages/Conflicts'
import { History } from './pages/History'
import { JobPage } from './pages/JobPage'
import { Jobs } from './pages/Jobs'
import { Preview } from './pages/Preview'
import { Targets } from './pages/Targets'
import { Trash } from './pages/Trash'
import { Welcome } from './pages/Welcome'
import { Settings } from './pages/settings/Settings'
import { DEFAULT_ACCENT, PRESET_HEXES, type LookProps } from './pages/settings/LookPage'
import { rememberedTile, settingsTiles } from './pages/settings/tiles'
import { WhatsNewCard } from './pages/settings/WhatsNewCard'
import {
  api,
  whenSignedOut,
  type ConflictListing,
  type Job,
  type Run,
  type RunEvent,
  type TrashSide,
  type Volume,
  type WindowSettings,
} from './lib/api'
import type { FindingListing } from './lib/anomalies'
import { mergeConflicts } from './lib/conflicts'
import { inJobOrder, mergeTrash, trashTotals } from './lib/trashView'
import { GoTo, type Place } from './lib/goTo'
import { Places } from './lib/places'
import { applyAccent, applyRainbow, applyShape, cacheAppearance, DEFAULT_SHAPE, rainbowState, type RainbowState, type Shape } from './lib/appearance'
import { storedLook, storedSlots, storeSlots } from './lib/look'
import { applyDisco } from './lib/disco'
import { getDisco, setDisco } from './lib/discoSetting'
import { BOTTOM_BAR_AXIS, CONTROL_AXES, getLabelMode, setLabelMode, type LabelAxis, type LabelMode } from './lib/controls'
import { useT } from './lib/i18n'
import { getMotion, setMotion, type MotionIntensity } from './lib/motion'
import type { NavCounts } from './lib/navModel'
import { useNavPins } from './lib/navPins'
import { navigate, useLocation } from './lib/router'
import { jobPlace, resolveRoute } from './lib/routes'
import { followDevice, paintTheme, storedTheme, storeTheme, type ThemeChoice } from './lib/theme'
import { wireTooltips } from './lib/tooltip'
import { isActivityView, onUpdateReady, useTrayWords } from './lib/desk'
import { ToastProvider, useToast } from './lib/toast'
import { startWhatsNew, useWhatsNew } from './lib/whatsNewStore'

/**
 * The login gate. App mounts only once there is a session, since its fetches
 * and event stream would all answer 401 on a protected install.
 */
export function Gate() {
  const [state, setState] = useState<'asking' | 'in' | 'out'>('asking')
  const [canReset, setCanReset] = useState(false)
  const [password, setPassword] = useState(false)

  const ask = useCallback(() => {
    api
      .session()
      .then((s) => {
        setCanReset(!!s.reset)
        setPassword(s.required)
        setState(s.required && !s.authenticated ? 'out' : 'in')
      })
      .catch(() => {
        // An unreachable engine is no password problem; App shows its own
        // banner for it.
        setState('in')
      })
  }, [])

  useEffect(ask, [ask])
  useEffect(() => whenSignedOut(() => setState('out')), [])

  if (state === 'asking') return null
  if (state === 'out') return <Login onIn={ask} canReset={canReset} />
  // The desktop app's tray window loads the same page.
  return isActivityView() ? (
    <Activity />
  ) : (
    <ToastProvider>
      <App signOut={password} />
    </ToastProvider>
  )
}

/** The width below which the rail gives way to the bar along the bottom. */
const SMALL_WINDOW = '(max-width: 639px)'

function useSmallWindow(): boolean {
  const [small, setSmall] = useState(() => window.matchMedia(SMALL_WINDOW).matches)
  useEffect(() => {
    const query = window.matchMedia(SMALL_WINDOW)
    const follow = () => setSmall(query.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])
  return small
}

const LABEL_AXES: LabelAxis[] = [...CONTROL_AXES, BOTTOM_BAR_AXIS]

/**
 * @param signOut whether a password is set, the one case where the rail
 *                offers to sign out.
 */
export function App({ signOut = false }: { signOut?: boolean }) {
  const { t, lang, setLanguage, languages } = useT()
  const { pathname, search } = useLocation()
  const pins = useNavPins()
  const small = useSmallWindow()
  const [jobs, setJobs] = useState<Job[]>([])
  // Whether the engine has listed its jobs once, which is what tells a first
  // start from an install that has jobs.
  const [jobsRead, setJobsRead] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [latest, setLatest] = useState<Run[]>([])
  const [progress, setProgress] = useState<Record<string, RunEvent>>({})
  const [speeds, setSpeeds] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  const [theme, setTheme] = useState<ThemeChoice>(storedTheme)
  const [shape, setShape] = useState<Shape>(() => storedLook().shape ?? DEFAULT_SHAPE)
  const [accent, setAccent] = useState<string>(() => storedLook().accent ?? DEFAULT_ACCENT)
  const [slots, setSlots] = useState(() => storedSlots(PRESET_HEXES))
  const [rainbow, setRainbow] = useState<RainbowState>(rainbowState)
  const [motion, setMotionState] = useState<MotionIntensity>(getMotion)
  const [disco, setDiscoState] = useState(getDisco)
  const [labels, setLabels] = useState(
    () => Object.fromEntries(LABEL_AXES.map((axis) => [axis, getLabelMode(axis)])) as Record<LabelAxis, LabelMode>,
  )
  // Only for naming a drive in the file log, so a failed fetch leaves the id.
  const [drives, setDrives] = useState<Volume[]>([])
  const places = useMemo(() => ({ jobs, drives }), [jobs, drives])
  // Null until asked, and always on a build with no window of its own.
  const [window_, setWindow] = useState<WindowSettings | null>(null)
  const [version, setVersion] = useState('dev')
  // The version as the engine stamps it, null until it has answered.
  const [running, setRunning] = useState<string | null>(null)
  // Null until the engine has said, so the Security tile's address does not
  // bounce to the first tile while the question is out.
  const [canSecure, setCanSecure] = useState<boolean | null>(null)
  useTrayWords(window_ !== null, t)
  useUpdateReadyToast()
  const push = useToast()

  const refresh = useCallback(() => {
    api
      .jobs()
      .then((got) => {
        setJobs(got)
        setJobsRead(true)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
    api
      .history(undefined, 'all', 50)
      .then(setRuns)
      .catch(() => {
        // The job list is still useful without the history.
      })
    api
      .latestRuns(new Date().toISOString())
      .then(setLatest)
      .catch(() => {})
  }, [])

  useEffect(() => {
    void api
      .volumes()
      .then((v) => setDrives(v.volumes))
      .catch(() => {})
    void api
      .capabilities()
      .then((can) => {
        setVersion(can.version || 'dev')
        setRunning(can.version || 'dev')
        setCanSecure(can.security === true)
        if (can.window) void api.window().then(setWindow)
      })
      .catch(() => setCanSecure(false))
  }, [])

  // What waits on somebody, for the two pages and their counts. Asked for in
  // full at the start and after a save, and for one job whenever one of its
  // runs ends, since a run is what sets a conflict aside or fills a trash.
  const [conflicts, setConflicts] = useState<ConflictListing | null>(null)
  const [trashSides, setTrashSides] = useState<TrashSide[] | null>(null)
  const reloadWaiting = useCallback((job: string) => {
    api
      .conflicts(job || undefined)
      .then((got) => setConflicts((prev) => mergeConflicts(prev, job, got)))
      .catch(() => {})
    api
      .trashAll(job || undefined)
      .then((got) => setTrashSides((prev) => mergeTrash(prev, job, got.sides)))
      .catch(() => {})
  }, [])
  // What the engine found about the jobs, asked for again whenever it says the
  // findings changed. `refused` counts the runs a brake refused, so the page
  // can tell a change that grew after it was let through.
  const [findings, setFindings] = useState<FindingListing | null>(null)
  const [refused, setRefused] = useState<Record<string, number>>({})
  const reloadFindings = useCallback(
    () =>
      api
        .anomalies()
        .then((got) => {
          setFindings(got)
          return got
        })
        .catch(() => null),
    [],
  )
  const orderedTrash = useMemo(
    () => (trashSides ? inJobOrder(trashSides, jobs.map((j) => j.name)) : null),
    [trashSides, jobs],
  )

  const goTo = useCallback((place: Place) => {
    navigate(place.tab === 'jobs' && place.job ? `/jobs/${encodeURIComponent(place.job)}` : jobPlace(place.tab, place.job))
  }, [])

  useEffect(() => {
    wireTooltips()
    refresh()
    reloadWaiting('')
    void reloadFindings()
    return api.watch((ev) => {
      if (ev.phase === 'anomaly') {
        void reloadFindings().then((got) => {
          const fresh = got?.open.find((f) => f.id === ev.told)
          if (!fresh) return
          const what = t(`anomaly.kind.${fresh.kind}`)
          push(
            fresh.held
              ? t('anomaly.heldNow', { job: fresh.job, what })
              : `${t('anomaly.noteTitle', { job: fresh.job })}: ${what}`,
            fresh.held ? 'fail' : undefined,
          )
        })
        return
      }
      // "moving" frames arrive twice a second during a run. Only their speed
      // is drawn here, and falling through would refetch the job list each
      // time.
      if (ev.phase === 'moving') {
        const speed = ev.speed ?? 0
        setSpeeds((prev) => ((prev[ev.job] ?? 0) === speed ? prev : { ...prev, [ev.job]: speed }))
        return
      }
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
      setSpeeds((prev) => {
        if (!(ev.job in prev)) return prev
        const next = { ...prev }
        delete next[ev.job]
        return next
      })
      refresh()
      if (ev.phase === 'finished') {
        reloadWaiting(ev.job)
        void reloadFindings()
        if (ev.held) setRefused((prev) => ({ ...prev, [ev.job]: (prev[ev.job] ?? 0) + 1 }))
      }
    })
    // The toast speaks the language of the moment the stream was opened; a
    // reconnect per language change would drop events for a word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, reloadWaiting, reloadFindings])

  useEffect(() => {
    paintTheme(theme)
    return followDevice(theme)
  }, [theme])
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

  // The first start lasts while there is no job. Null until the jobs are read.
  const fresh = jobsRead ? jobs.length === 0 : null
  const news = useWhatsNew()
  useEffect(() => {
    if (running !== null && fresh !== null) startWhatsNew(running, !fresh)
  }, [running, fresh])

  const tiles = useMemo(() => settingsTiles(canSecure), [canSecure])
  const resolved = useMemo(
    () => resolveRoute(pathname, search, { pins, tiles: tiles.map((x) => x.id), remembered: rememberedTile(), fresh }),
    [pathname, search, pins, tiles, fresh],
  )
  useLayoutEffect(() => {
    if ('redirect' in resolved) navigate(resolved.redirect, { replace: true })
  }, [resolved])
  const view = 'view' in resolved ? resolved.view : null

  // Nothing can need attention during the first start, so the rail counts nothing.
  const counts: NavCounts = fresh
    ? { running: 0, conflicts: 0, trash: 0, findings: 0 }
    : {
        running: jobs.filter((j) => j.running).length,
        conflicts: conflicts?.conflicts.length ?? 0,
        trash: orderedTrash ? trashTotals(orderedTrash.filter((s) => !s.error)).entries : 0,
        findings: findings?.open.length ?? 0,
      }
  // The job a link from another page narrowed this one to.
  const focus = search.get('job') ?? ''

  const look: LookProps = {
    theme,
    onTheme: (next) => {
      setTheme(next)
      storeTheme(next)
    },
    shape,
    onShape: setShape,
    accent,
    onAccent: setAccent,
    slots,
    onSlots: (next) => {
      setSlots(next)
      storeSlots(next)
    },
    rainbow,
    onRainbow: setRainbow,
    disco,
    onDisco: (on) => {
      setDisco(on)
      setDiscoState(on)
    },
    motion,
    onMotion: (next) => {
      setMotion(next)
      setMotionState(next)
    },
    labels,
    onLabels: (axis, next) => {
      setLabelMode(axis, next)
      setLabels((prev) => ({ ...prev, [axis]: next }))
    },
    lang,
    onLang: setLanguage,
    languages,
  }

  const anomalies = (
    <Anomalies listing={findings} jobs={jobs} job={focus} refused={refused} onChanged={() => void reloadFindings()} />
  )

  const page = !view ? null : view.page === 'welcome' ? (
    <Welcome fresh={fresh} />
  ) : view.page === 'jobs' ? (
    <Jobs
      jobs={jobs}
      findings={findings?.open ?? []}
      latest={latest}
      progress={progress}
      speeds={speeds}
      onPreview={(name) => navigate(`/jobs/${encodeURIComponent(name)}/preview`)}
      onSaved={() => {
        refresh()
        reloadWaiting('')
      }}
    />
  ) : view.page === 'job' ? (
    <JobPage name={view.name} />
  ) : view.page === 'preview' ? (
    <Preview
      job={view.name}
      onDone={() => {
        navigate('/jobs')
        refresh()
      }}
    />
  ) : view.page === 'targets' ? (
    <Targets />
  ) : view.page === 'conflicts' ? (
    <Conflicts listing={conflicts} job={focus} onChanged={reloadWaiting} />
  ) : view.page === 'anomalies' ? (
    anomalies
  ) : view.page === 'trash' ? (
    <Trash sides={orderedTrash} job={focus} onChanged={reloadWaiting} />
  ) : view.page === 'history' ? (
    // The log is the whole page, so its card reaches the bottom of the
    // window however few lines it has.
    <div className="flex flex-1 flex-col *:flex-1">
      <History runs={runs} jobs={jobs} />
    </div>
  ) : null

  return (
    // A fixed rail and a page that scrolls beside it, or above the bar where
    // the window is too narrow for both side by side. The gutter padding lets
    // the rail float as a card on the ground. Beside the rail the page reaches
    // down through the gutter and pads its end by the same amount, so a page
    // that fills the window, or one scrolled to its end, stops on the rail's
    // bottom line with room for its cards' shadow.
    <div className="flex h-screen flex-col overflow-hidden bg-carbon-background p-[var(--page-gutter)] sm:flex-row sm:gap-4">
      {!small && <Sidebar pins={pins} counts={counts} pathname={pathname} mode={labels.sidebar} signOut={signOut} />}

      <Places.Provider value={places}>
        <GoTo.Provider value={goTo}>
          {view?.page === 'settings' ? (
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Settings
                tile={view.tile}
                tiles={tiles}
                look={look}
                version={version}
                window={window_}
                onWindow={(next) => {
                  const before = window_
                  setWindow(next)
                  api
                    .saveWindow(next)
                    .then(setWindow)
                    .catch((e: Error) => {
                      setWindow(before)
                      push(e.message, 'fail')
                    })
                }}
                targets={<Targets />}
                anomalies={anomalies}
                whatsNew={<WhatsNewCard hueIndex={2} />}
              />
            </main>
          ) : (
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto sm:-mb-[var(--page-gutter)]">
              {/* Keyed on the address, so the subtree remounts and GlimStone's
                  entrance animation plays on every page change. */}
              <div
                key={pathname}
                className="glim-page-enter flex min-h-full w-full flex-col gap-8 pb-4 sm:px-6 sm:pb-[var(--page-gutter)] md:px-8"
              >
                {error && (
                  <Card title={t('error.unreachable')} hueIndex={0}>
                    <p className="text-subline text-statusFail">{error}</p>
                  </Card>
                )}
                {page}
              </div>
            </main>
          )}
        </GoTo.Provider>
      </Places.Provider>

      {small && <BottomBar pins={pins} counts={counts} pathname={pathname} signOut={signOut} />}

      <WhatsNewDots news={news} active={fresh === false && news?.version === running && view?.page !== 'welcome'} />
    </div>
  )
}

/**
 * Says once that the desktop app has downloaded a newer version for its next
 * start. A window waiting in the notification area says it when it comes back
 * rather than to nobody.
 */
function useUpdateReadyToast() {
  const { t } = useT()
  const push = useToast()
  useEffect(
    () =>
      onUpdateReady((version) => {
        const show = () => push(t('update.ready', { version }))
        if (!document.hidden) {
          show()
          return
        }
        const onVisible = () => {
          if (document.hidden) return
          document.removeEventListener('visibilitychange', onVisible)
          show()
        }
        document.addEventListener('visibilitychange', onVisible)
      }),
    [push, t],
  )
}
