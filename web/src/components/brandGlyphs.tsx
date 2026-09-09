import type { SVGProps } from 'react'

// ---------------------------------------------------------------------------
// Brand marks, kept apart from the app's own icon set on purpose.
//
// `glyphs.tsx` is GENERATED from one Streamline set, drawn on one grid to one
// convention, which is what makes those icons agree with each other. A brand
// mark cannot come from there: it is somebody else's drawing, it must not be
// redrawn to fit, and it must not be swapped for a near neighbour when the set
// lacks it. So it lives here, by hand, with its source and its trademark note
// beside it - the same arrangement `scripts/brand-paths/` already uses for the
// platform marks on the README's download buttons.
//
// The design language states the other half of the rule: a brand mark is never
// reachable by PATTERN from a translation key. A glyph rule keyed on "repo"
// would put this logo on repository settings that have nothing to do with
// GitHub, and the day this project moves to another forge the mark would follow
// it there and be wrong. It is passed at the one call site that means it.
// ---------------------------------------------------------------------------

/**
 * GitHub's mark, on the button that opens this project's repository.
 *
 * Source: Simple Icons (simpleicons.org), which publishes its icons under CC0 -
 * no attribution required, given here because knowing where a drawing came from
 * is worth more than the licence demands.
 *
 * GitHub and the GitHub logo are trademarks of GitHub, Inc. Used here the one
 * way a trademark may be used without permission: to name the thing it refers
 * to. The button carrying it opens a GitHub repository, the mark is reproduced
 * unmodified, and nothing about it claims endorsement or affiliation.
 *
 * The viewBox is cropped to the drawn ink rather than left at the source's
 * square, so the mark reads at the same optical size as the generated glyphs
 * beside it instead of sitting slightly small inside its own padding. Same
 * numbers the sibling app measured for this identical path.
 */
export function IconGithub(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0.297 24 23.406" width="1em" height="1em" fill="currentColor" aria-hidden {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}
