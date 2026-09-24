/**
 * The two arrows as drawn lines, for the logo's morph: index.css bends their
 * shafts from the logo's S curves into one closed ring and then into straight
 * arrows. Drawn inside LogoMark's arrow group, so they turn with it, and hidden
 * until the real arrows hand over to them in mid spin, where the swap cannot be
 * seen.
 *
 * The heads and tails are markers, so they follow the shaft's ends through
 * every shape. The greys are the arrow's own.
 */
export function LogoLoop() {
  return (
    <g className="al-logo-loop">
      <defs>
        <marker
          id="al-loop-head"
          viewBox="0 0 10 10"
          refX="3"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="60"
          markerHeight="60"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 L2,5 Z" fill="#72767d" />
          <path d="M0,0 L10,5 L2,5 Z" fill="#b4b8b9" />
        </marker>
        <marker
          id="al-loop-tail"
          viewBox="0 0 12 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="60"
          markerHeight="50"
          orient="auto"
        >
          <path d="M0,0 L5,0 L11,5 L5,10 L0,10 L6,5 Z" fill="#72767d" />
          <path d="M0,0 L5,0 L11,5 L6,5 Z" fill="#b4b8b9" />
        </marker>
      </defs>
      {/* The S curves are also the `d` attributes, for a browser that cannot
          animate `d`: it turns and throws the arrows without bending them. */}
      <g className="al-logo-fly-up">
        <path
          className="al-logo-shaft al-logo-bend-up"
          d={UP_S}
          markerStart="url(#al-loop-tail)"
          markerEnd="url(#al-loop-head)"
        />
        <path className="al-logo-shine al-logo-bend-up" d={UP_S} />
      </g>
      <g className="al-logo-fly-down">
        <path
          className="al-logo-shaft al-logo-bend-down"
          d={DOWN_S}
          markerStart="url(#al-loop-tail)"
          markerEnd="url(#al-loop-head)"
        />
        <path className="al-logo-shine al-logo-bend-down" d={DOWN_S} />
      </g>
    </g>
  )
}

const UP_S = 'M352,58 C314,98 288,120 254,127 C220,134 196,146 186,168 C176,188 175,206 179,224'
const DOWN_S =
  'M59.7,353.7 C97.7,313.7 123.7,291.7 157.7,284.7 C191.7,277.7 215.7,265.7 225.7,243.7 C235.7,223.7 236.7,205.7 232.7,187.7'
