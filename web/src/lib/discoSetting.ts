/** Whether the disco switch is on. The walk itself lives in disco.ts. */

const KEY = 'arrowloop.disco'

export function getDisco(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setDisco(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Without storage the switch holds until the page reloads.
  }
}
