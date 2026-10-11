// Writes desktop/build/sounds/ArrowLoop.wav, the sound of a desktop
// notification: an arrow that whizzes in and hits a metal shield. It is
// synthesised here rather than taken from a sound library so that its licence
// is the project's own.
//
// Run with: node scripts/gen_sound.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rate = 44100
const length = 1.2
const hit = 0.15

// A fixed seed, so every run writes the same file.
let seed = 7
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1

// A band-pass biquad whose centre may move from one sample to the next.
let x1 = 0, x2 = 0, y1 = 0, y2 = 0
function bandpass(x, f, q) {
  const w = (2 * Math.PI * f) / rate
  const a = Math.sin(w) / (2 * q)
  const c = Math.cos(w)
  const y = (a * x - a * x2 + 2 * c * y1 - (1 - a) * y2) / (1 + a)
  x2 = x1; x1 = x; y2 = y1; y1 = y
  return y
}

// The shield's partials are not a chord, which is what makes it sound like
// metal rather than a bell: [frequency, level, decay per second].
const ring = [
  [925, 0.35, 5],
  [1250, 0.45, 4.2],
  [1630, 0.6, 3.6],
  [2650, 0.25, 7],
]

const samples = new Float64Array(Math.round(rate * length))
for (let i = 0; i < samples.length; i++) {
  const t = i / rate
  if (t < hit) {
    // The whizz rises in pitch as the arrow comes closer and stops just
    // before it lands.
    const p = t / hit
    const env = p < 0.75 ? Math.sin((Math.PI * p) / 0.75) ** 2 : 0
    samples[i] += 2.2 * env * bandpass(noise(), 450 + 400 * p, 2.5) * 6
  }
  const d = t - hit
  if (d >= 0) {
    samples[i] += 0.6 * Math.exp(-d * 90) * (noise() * 0.6 + Math.sin(2 * Math.PI * 240 * d))
    for (const [hz, level, decay] of ring) {
      samples[i] += level * Math.min(1, d / 0.0015) * Math.exp(-d * decay) * Math.sin(2 * Math.PI * hz * d)
    }
  }
}

const fade = Math.round(rate * 0.04)
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
