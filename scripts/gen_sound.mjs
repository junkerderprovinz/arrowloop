// Writes desktop/build/sounds/ArrowLoop.wav, the sound of a desktop
// notification: two soft bell notes, a fourth apart. It is made here rather
// than taken from a sound library so that its licence is the project's own.
//
// Run with: node scripts/gen_sound.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rate = 44100
const length = 0.9
const notes = [
  { at: 0, hz: 987.77 },
  { at: 0.14, hz: 1318.51 },
]

const samples = new Float64Array(Math.round(rate * length))
for (const { at, hz } of notes) {
  const start = Math.round(at * rate)
  for (let i = start; i < samples.length; i++) {
    const t = (i - start) / rate
    // A few milliseconds of attack keep the start from clicking.
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 6)
    samples[i] += env * (Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(4 * Math.PI * hz * t))
  }
}

// Fades the last 50 ms to silence, so the end does not click either.
const fade = Math.round(rate * 0.05)
for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade

let peak = 0
for (const s of samples) peak = Math.max(peak, Math.abs(s))
const gain = 0.5 / peak

const data = Buffer.alloc(samples.length * 2)
samples.forEach((s, i) => data.writeInt16LE(Math.round(s * gain * 32767), i * 2))

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22)
header.writeUInt32LE(rate, 24)
header.writeUInt32LE(rate * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(data.length, 40)

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'build', 'sounds', 'ArrowLoop.wav')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.concat([header, data]))
console.log(`wrote ${out}`)
