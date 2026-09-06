package main

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/math/f64"
)

// The notification area icon, and the four things it can say without a word.
//
// A tray icon is the only part of this program somebody sees while doing
// something else, so it is the only place where a state has to read at a glance
// and at sixteen pixels. Three states and one motion:
//
//	idle     the mark as drawn
//	working  the mark, turning
//	settled  the mark in green
//	failed   the mark in red
//
// The frames are derived from the one PNG the program already embeds rather
// than committed as a set of files. The reason is the same one the ICO wrapper
// gives: a second copy of the logo is a second thing to remember when the logo
// changes, and here it would be forty of them.
//
// Turning rather than blinking, because the mark is a loop: a ring that rotates
// is the drawing doing what it depicts, and it stays legible at a size where a
// blinking dot would just look broken.

// TrayState is what the icon is currently saying.
type TrayState int

const (
	TrayIdle TrayState = iota
	TrayWorking
	TraySettled
	TrayFailed
)

// Frames is how many steps one full turn is cut into.
//
// Twelve at eighty milliseconds is a turn a second, which reads as deliberate
// rather than frantic. More frames would be smoother and would also be more
// icons to hold in memory and more messages to the shell for something nobody
// looks at directly.
const Frames = 12

// tint colours, chosen for a sixteen pixel square rather than for a page: at
// that size a subtle shade is no shade at all, so these are saturated.
var (
	settledInk = color.RGBA{R: 0x2E, G: 0xB8, B: 0x5C, A: 0xFF}
	failedInk  = color.RGBA{R: 0xE0, G: 0x3B, B: 0x3B, A: 0xFF}
)

// TraySet is every icon this program will ever show, built once at startup.
//
// Built once rather than on demand because a rotation is a resample of every
// pixel and this runs while files are being copied. Twelve small images cost a
// few hundred kilobytes and remove the question entirely.
type TraySet struct {
	Idle    []byte
	Settled []byte
	Failed  []byte
	Working [][]byte
}

// BuildTraySet derives every icon from the one embedded PNG.
//
// An error here is not fatal to the program, only to the decoration: the caller
// falls back to the plain icon, because a missing spin is a worse tray icon and
// a refusal to start is a worse program.
func BuildTraySet(source []byte) (*TraySet, error) {
	src, err := png.Decode(bytes.NewReader(source))
	if err != nil {
		return nil, err
	}

	idle, err := encodeICO(src)
	if err != nil {
		return nil, err
	}
	settled, err := encodeICO(tinted(src, settledInk))
	if err != nil {
		return nil, err
	}
	failed, err := encodeICO(tinted(src, failedInk))
	if err != nil {
		return nil, err
	}

	working := make([][]byte, 0, Frames)
	for i := 0; i < Frames; i++ {
		frame, err := encodeICO(rotated(src, 2*math.Pi*float64(i)/float64(Frames)))
		if err != nil {
			return nil, err
		}
		working = append(working, frame)
	}

	return &TraySet{Idle: idle, Settled: settled, Failed: failed, Working: working}, nil
}

// tinted recolours the ink while leaving the transparent ground alone.
//
// Every visible pixel takes the target colour at its own brightness, so the
// drawing keeps its shading and its edges instead of turning into a silhouette.
// Working from luminance rather than from a hue rotation is what makes this
// hold up on a mark that is mostly one colour already: a hue shift on gold
// gives green, and the same shift on the grey ring gives grey.
func tinted(src image.Image, ink color.RGBA) image.Image {
	b := src.Bounds()
	out := image.NewNRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, a := src.At(x, y).RGBA()
			if a == 0 {
				continue
			}
			// Rec. 601 luma, on the straight (un-premultiplied) values, so a
			// half-transparent edge pixel is not read as a dark one.
			if a < 0xFFFF {
				r = r * 0xFFFF / a
				g = g * 0xFFFF / a
				bl = bl * 0xFFFF / a
			}
			lum := (299*r + 587*g + 114*bl) / 1000 / 0x101
			out.SetNRGBA(x, y, color.NRGBA{
				R: scale(ink.R, uint8(lum)),
				G: scale(ink.G, uint8(lum)),
				B: scale(ink.B, uint8(lum)),
				A: uint8(a / 0x101),
			})
		}
	}
	return out
}

// scale brightens or darkens one channel of the target colour by the source's
// own brightness, with the midpoint left alone so a mid-grey pixel comes out as
// the target colour itself.
func scale(c, lum uint8) uint8 {
	v := int(c) * int(lum) / 128
	if v > 255 {
		return 255
	}
	return uint8(v)
}

// rotated turns the image about its centre.
//
// Bi-linear rather than nearest neighbour: at this size a nearest-neighbour
// rotation makes the ring crawl and shimmer, which is the one thing a spinning
// icon must not do, because it reads as a rendering fault rather than motion.
func rotated(src image.Image, angle float64) image.Image {
	b := src.Bounds()
	out := image.NewNRGBA(b)
	cx := float64(b.Min.X+b.Max.X) / 2
	cy := float64(b.Min.Y+b.Max.Y) / 2

	// Translate to the centre, turn, translate back. The matrix is written out
	// rather than composed, because three multiplications of a 2x3 are harder
	// to read than the six numbers they produce.
	sin, cos := math.Sin(angle), math.Cos(angle)
	m := f64.Aff3{
		cos, -sin, cx - cx*cos + cy*sin,
		sin, cos, cy - cx*sin - cy*cos,
	}
	xdraw.BiLinear.Transform(out, m, src, b, draw.Src, nil)
	return out
}

// encodeICO re-encodes an image and wraps it the way Windows wants it.
func encodeICO(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return icoFromPNG(buf.Bytes())
}
