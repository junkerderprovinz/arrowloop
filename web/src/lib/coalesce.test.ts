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

  // Read from the source, since no renderer here reaches the phone.
  it.each(['conflicts', 'trashAll'])(
    'is how the phone app asks for its %s count, so tab changes cannot pile questions up',
    (call) => {
      const source = readFileSync(new URL('../../../mobile/src/waiting.tsx', import.meta.url), 'utf8')
      expect(source).toContain('from "../../web/src/lib/coalesce"')
      expect(source.match(new RegExp(String.raw`api\s*\.${call}\(`, 'g'))).toHaveLength(1)
      expect(source).toMatch(new RegExp(String.raw`^const \w+ = coalesce\(\(\) => api\.${call}\(\)`, 'm'))
    },
  )
})
