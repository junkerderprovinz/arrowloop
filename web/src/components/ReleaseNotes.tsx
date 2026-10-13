import type { ReactNode } from 'react'

import { followExternal } from '../lib/external'

/** Only these become links, so a javascript: address in a note stays text. */
function safeHref(url: string): string | null {
  const u = url.trim()
  return /^(https?:|mailto:)/i.test(u) ? u : null
}

/** **bold**, `code` and [text](url); everything else stays text, which React escapes. */
function inline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  let i = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[1] !== undefined) {
      const href = safeHref(m[2])
      nodes.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" onClick={followExternal} className="text-accentInk underline hover:no-underline">
            {m[1]}
          </a>
        ) : (
          m[1]
        ),
      )
    } else if (m[3] !== undefined) {
      nodes.push(
        <strong key={k} className="font-semibold text-carbon-text">
          {m[3]}
        </strong>,
      )
    } else {
      nodes.push(
        <code key={k} className="rounded-control bg-carbon-surface2 px-1 py-px text-subline text-carbon-text">
          {m[4]}
        </code>,
      )
    }
    last = re.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/**
 * One release's notes, read as the subset of Markdown they are written in:
 * headings, bullets, rules and paragraphs, as BombVault's What's new renders
 * them.
 */
export function ReleaseNotes({ body }: { body: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  let key = 0

  const flush = () => {
    if (list.length === 0) return
    const k = key++
    blocks.push(
      <ul key={k} className="my-2 ms-5 list-disc space-y-1 text-body leading-relaxed text-carbon-textSub">
        {list.map((item, i) => (
          <li key={i}>{inline(item, `${k}-${i}`)}</li>
        ))}
      </ul>,
    )
    list = []
  }

  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    const bullet = line.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      list.push(bullet[1])
      continue
    }
    flush()
    if (line === '') continue
    const k = key++
    if (/^([-*_])\1{2,}$/.test(line)) {
      blocks.push(<hr key={k} className="my-4 border-carbon-border" />)
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push(
        heading[1].length <= 2 ? (
          <h4 key={k} className="mb-1 mt-4 text-body font-semibold text-carbon-text first:mt-0">
            {inline(heading[2], `${k}`)}
          </h4>
        ) : (
          <h5 key={k} className="mb-1 mt-3 text-subline font-semibold text-carbon-textSub">
            {inline(heading[2], `${k}`)}
          </h5>
        ),
      )
      continue
    }
    blocks.push(
      <p key={k} className="my-2 text-body leading-relaxed text-carbon-textSub">
        {inline(line, `${k}`)}
      </p>,
    )
  }
  flush()
  return <div>{blocks}</div>
}
