// The kit's sign-in as ArrowLoop talks to it: one client for the sign-in page,
// the Security tile and the password question before a change that wants a
// fresh sign-in.

import { createSignInApi, takeSignInCode, type SignInApi, type SignInReauth, type SignInReauthState } from '@glimstone/core'

import { ApiError, endSession } from './api'
import { basePath } from './base'

export const signIn = createSignInApi({ root: basePath() })

/**
 * The kit's client asks for the password only before its own changes.
 * Showing or changing a phrase wants a fresh sign-in too, so one question
 * serves both, and SignInReauthWindow draws whichever is waiting.
 */
function shareQuestion(kit: SignInReauth) {
  let own: SignInReauthState = { asking: false, password: '', busy: false, error: null, refused: 0 }
  const listeners = new Set<() => void>()
  let waiting: ((confirmed: boolean) => void) | null = null
  const update = (change: Partial<SignInReauthState>) => {
    own = { ...own, ...change }
    listeners.forEach((fn) => fn())
  }
  const settle = (confirmed: boolean) => {
    const resume = waiting
    waiting = null
    update({ asking: false, password: '', busy: false, error: null })
    resume?.(confirmed)
  }
  const kitAsks = () => kit.state().asking

  const reauth: SignInReauth = {
    state: () => (kitAsks() ? kit.state() : own),
    subscribe(listener) {
      listeners.add(listener)
      const stop = kit.subscribe(listener)
      return () => {
        listeners.delete(listener)
        stop()
      }
    },
    set: (password) => (kitAsks() ? kit.set(password) : update({ password, error: null })),
    async submit() {
      if (kitAsks()) return kit.submit()
      if (!own.asking || own.busy || own.password === '') return
      update({ busy: true, error: null })
      const r = await signIn.confirm(own.password)
      if (r.ok) settle(true)
      else update({ busy: false, error: r.error, refused: own.refused + 1 })
    },
    cancel: () => (kitAsks() ? kit.cancel() : settle(false)),
  }

  let pending: Promise<boolean> | null = null
  // Without a window listening there is nobody to answer, so the change keeps its refusal.
  const ask = (): Promise<boolean> => {
    if (listeners.size === 0) return Promise.resolve(false)
    pending ??= new Promise<boolean>((resolve) => {
      waiting = resolve
      update({ asking: true, password: '', error: null })
    }).finally(() => (pending = null))
    return pending
  }
  return { reauth, ask }
}

const question = shareQuestion(signIn.reauth)

/** The client SignInReauthWindow listens to, which asks for the kit and for ArrowLoop alike. */
export const reauthClient: SignInApi = { ...signIn, reauth: question.reauth }

/** A refusal that wants a fresh sign-in, which the person answered or was sent away for. */
export const wantsSignIn = (e: unknown): boolean => e instanceof ApiError && e.code === 'signInAgain'

/**
 * Runs a change, and once more after the password when it wants a fresh
 * sign-in. Where the kit may not ask, such as for somebody who came in
 * through a sign-in service, the page goes to the sign-in instead.
 */
export async function withPassword<T>(change: () => Promise<T>): Promise<T> {
  try {
    return await change()
  } catch (e) {
    if (!wantsSignIn(e)) throw e
    if ((e as ApiError).askPassword) {
      if (await question.ask()) return change()
    } else {
      void signIn.logout().finally(() => endSession('again'))
    }
    throw e
  }
}

/** Which line the sign-in page opens with after the page reloads. */
export type SignInNote = 'bye' | 'again' | 'ended'

const NOTE = 'arrowloop.signInNote'

function leaveNote(note: SignInNote) {
  try {
    sessionStorage.setItem(NOTE, note)
  } catch {
    // Without storage the page simply opens without the line.
  }
}

let left: SignInNote | null | undefined

/** The line left before the reload, read once, so asking twice gets the same answer. */
export function takeNote(): SignInNote | null {
  if (left !== undefined) return left
  try {
    const note = sessionStorage.getItem(NOTE)
    sessionStorage.removeItem(NOTE)
    left = note === 'bye' || note === 'again' || note === 'ended' ? note : null
  } catch {
    left = null
  }
  return left
}

/** Signs out here and opens the sign-in page with its goodbye. */
export function signOutHere() {
  void signIn.logout().finally(() => {
    leaveNote('bye')
    window.location.reload()
  })
}

let arrival: string | null = null

/**
 * The code a sign-in service sent the browser back with. It leaves the
 * address the first time anybody asks, so a reload does not say it again,
 * and stays here until it was said. The sign-in page shows it, or the
 * Security tile, whichever the page draws.
 */
export function arrivalCode(): string | null {
  const code = takeSignInCode()
  if (code !== null) arrival = code
  return arrival
}

/** Forgets the code once it was said, or once it belongs to a sign-in that is over. */
export function dropArrival() {
  arrival = null
}
