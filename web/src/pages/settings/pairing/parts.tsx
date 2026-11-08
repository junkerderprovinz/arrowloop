// The small pieces the pairing cards share, drawn as BombVault's settings rows.
import type { CSSProperties, ReactNode } from 'react'

/** A list of rows with a hairline between them. */
export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-carbon-border/60">
      {children}
    </ul>
  )
}

/** One instance of the group: a glyph, its name with a line under it, and what to say or do about it at the end. */
export function Row({ glyph, name, note, children }: { glyph: ReactNode; name: string; note?: string; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className={`flex min-w-0 flex-col gap-0.5${note ? ' flex-1 basis-56' : ''}`}>
        <span className="flex items-center gap-1.5 text-body text-carbon-text">
          <span className="inline-flex flex-none text-accentGlyph [&_svg]:h-[18px] [&_svg]:w-[18px]">{glyph}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
        </span>
        {note && <span className="text-meta text-carbon-textMuted [overflow-wrap:anywhere]">{note}</span>}
      </div>
      {children && <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{children}</div>}
    </li>
  )
}

/** A word in small capitals beside a name, such as what kind of instance it is. */
export function Mark({ children }: { children: ReactNode }) {
  return <span className="text-meta uppercase tracking-[.12em] text-carbon-textSub">{children}</span>
}

/** A card's own buttons, under its content at the end. */
export function CardFoot({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
}

/** One fact about a relay route, behind its glyph. */
export function Fact({ glyph, children }: { glyph: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-body text-carbon-textSub">
      <span className="text-carbon-textMuted">{glyph}</span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** The bold lead of a fact, such as "You need:". */
export function Lead({ children }: { children: string }) {
  return <strong className="font-semibold text-carbon-text">{children} </strong>
}

/** clock writes seconds as minutes and seconds, 75 as "1:15". */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A line under the group that says it is still waiting, with three breathing dots. */
export function WaitRow({ text, seconds }: { text: string; seconds?: number }) {
  return (
    <div className="flex items-center gap-3 border-t border-carbon-border/60 pt-3 text-carbon-textSub">
      <span className="flex shrink-0 gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="al-wait-dot h-1.5 w-1.5 rounded-full bg-accentGlyph" style={{ '--dot': i } as CSSProperties} />
        ))}
      </span>
      <span className="text-body">{text}</span>
      {seconds !== undefined && <span className="glim-num ms-auto text-meta text-carbon-textMuted">{clock(seconds)}</span>}
    </div>
  )
}
