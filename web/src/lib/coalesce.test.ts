import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { coalesce } from './coalesce'

/** A question whose answer the test hands over when it wants to. */
function heldQuestion() {
  const answers: (() => void)[] = []
  const ask = () =>
    new Promise<void>((resolve) => {
      answers.push(resolve)
    })
  return { ask, answers }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('coalesce', () => {
  it('keeps one question out and asks once more for every call made meanwhile', async () => {
    const { ask, answers } = heldQuestion()
    const trigger = coalesce(ask, 0)

    trigger()
    trigger()
    trigger()
    expect(answers).toHaveLength(1)

    answers[0]!()
    await settled()
    expect(answers).toHaveLength(2)

    answers[1]!()
    await settled()
    expect(answers).toHaveLength(2)
  })

  it('asks again after a question that failed', async () => {
    let asked = 0
    const trigger = coalesce(() => {
      asked++
      return Promise.reject(new Error('gone'))
    }, 0)

    trigger()
    await settled()
    trigger()
    await settled()
    expect(asked).toBe(2)
  })

  // Read from the source, since no renderer here reaches the phone. A target
  // that hangs keeps its listing out for as long as the engine waits on it,
  // and every listing out takes one of the few connections the app's HTTP
  // client opens to the engine.
  it('is how the phone app asks for its trash count, so tab changes cannot pile listings up', () => {
    const source = readFileSync(new URL('../../../mobile/src/waiting.tsx', import.meta.url), 'utf8')
    expect(source).toContain('from "../../web/src/lib/coalesce"')
    expect(source.match(/api\s*\.trashAll\(/g)).toHaveLength(1)
    expect(source).toMatch(/coalesce\(\s*\(\)\s*=>\s*api\s*\.trashAll\(\)/)
  })
})
