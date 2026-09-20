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

// TrayState is what the notification area icon is currently saying: the mark as
// drawn, turning, in green or in red. Every frame is derived from the embedded
// PNG, so a new logo needs no second set of files.
type TrayState int

const (
	TrayIdle TrayState = iota
	TrayWorking
	TraySettled
	TrayFailed
)

// Frames is how many steps one full turn is cut into; at eighty milliseconds
// each that is a turn a second.
const Frames = 12

// Saturated, since a subtle shade does not read at sixteen pixels.
var (
	settledInk = color.RGBA{R: 0x2E, G: 0xB8, B: 0x5C, A: 0xFF}
	failedInk  = color.RGBA{R: 0xE0, G: 0x3B, B: 0x3B, A: 0xFF}
)

// TraySet is every icon this program will ever show, built once at startup so
// no rotation is resampled while files are being copied.
type TraySet struct {
	Idle    []byte
	Settled []byte
	Failed  []byte
	Working [][]byte
}

// BuildTraySet derives every icon from the one embedded PNG. On an error the
// caller falls back to the plain icon.
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

// tinted recolours the ink while leaving the transparent ground alone. Each
// visible pixel takes the target colour at its own luminance, so the drawing
// keeps its shading, and the grey ring changes colour where a hue shift would
// leave it grey.
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

// rotated turns the image about its centre. Bilinear, because a
// nearest-neighbour rotation makes the ring shimmer at this size.
func rotated(src image.Image, angle float64) image.Image {
	b := src.Bounds()
	out := image.NewNRGBA(b)
	cx := float64(b.Min.X+b.Max.X) / 2
	cy := float64(b.Min.Y+b.Max.Y) / 2

	// Translate to the centre, turn, translate back, written out as one matrix.
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
