/**
 * Hand a file to the browser.
 *
 * The anchor is attached before the click because some browsers ignore a click
 * on a detached one, and the object URL is revoked so its blob does not stay in
 * memory for the life of the page.
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
  // The download starts asynchronously, and a URL revoked before it begins
  // hands the browser nothing.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Read one file the person picked, as text. Resolves with null when the picker is dismissed. */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)

    // Removed on change and on cancel alike, so a dismissed picker does not
    // leave the input in the document.
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
