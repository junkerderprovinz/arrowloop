import { useCallback, useEffect, useState } from 'react'

import { Card, Stack } from './components/Shell'
import { Choice, Field, Info, Switch } from './components/Field'
import { Selector } from './components/Selector'
import { History, Jobs } from './pages/Jobs'
import { Preview } from './pages/Preview'
import { Editor } from './pages/Editor'
import { Targets } from './pages/Targets'
import { api, type Job, type Run, type RunEvent } from './lib/api'
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
import { languageFlag, useT } from './lib/i18n'
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
            { value: 'jobs', label: t('nav.jobs'), icon: '⇄' },
            { value: 'edit', label: t('nav.edit'), icon: '✎' },
            { value: 'targets', label: t('nav.targets'), icon: '⌂' },
            { value: 'history', label: t('nav.history'), icon: '☰' },
            { value: 'look', label: t('nav.look'), icon: '◐' },
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
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((p) => (
            <button
              key={p.hex}
              onClick={() => onAccent(p.hex)}
              title={p.name}
              data-tip={p.name}
              aria-label={p.name}
              aria-pressed={accent === p.hex}
              className="h-8 w-8 transition"
              style={{
                background: p.hex,
                borderRadius: 'var(--radius-pill)',
                outline: accent === p.hex ? '2px solid var(--carbon-text)' : 'none',
                outlineOffset: '2px',
              }}
            />
          ))}
        </div>
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
        </div>
      </Card>
    </Stack>
  )
}
