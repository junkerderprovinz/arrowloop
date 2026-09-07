/**
 * Hand a file to the browser.
 *
 * One place rather than three, because the cleanup is the part that gets
 * forgotten: an object URL that is never revoked keeps its whole blob in memory
 * for the life of the page, and the leak is invisible until somebody exports a
 * long run log a few dozen times.
 *
 * The anchor is added to the document before it is clicked. A detached anchor
 * works in some browsers and silently does nothing in others, which is the
 * worst of both: it looks fine everywhere it was tested.
 */
export function download(name: string, body: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([body], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Not revoked in the same tick: the click starts the download asynchronously,
  // and a URL revoked before it begins hands the browser nothing at all.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Read one file the person picked, as text.
 *
 * Resolves with null when the picker is dismissed, which is not an error and
 * must not be reported as one.
 */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)

    // Cancelling a file picker fires no event in most browsers, so this listener
    // is what stops a dismissed dialog from leaving an <input> in the document
    // for ever. It is deliberately one-shot on either path.
    const done = (value: { name: string; text: string } | null) => {
      input.remove()
      resolve(value)
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return done(null)
      file
        .text()
        .then((text) => done({ name: file.name, text }))
        .catch(() => done(null))
    })
    input.addEventListener('cancel', () => done(null))
    input.click()
  })
}
