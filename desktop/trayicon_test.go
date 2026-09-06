package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// A small stand-in for the real mark: a gold ring on nothing, which is the one
// property every check below actually depends on.
func sample(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			dx, dy := float64(x-16), float64(y-16)
			d := dx*dx + dy*dy
			if d > 64 && d < 144 {
				img.SetNRGBA(x, y, color.NRGBA{R: 0xFC, G: 0xC4, B: 0x19, A: 0xFF})
			}
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode: %v", err)
	}
	return buf.Bytes()
}

func TestBuildTraySetProducesEveryState(t *testing.T) {
	set, err := BuildTraySet(sample(t))
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if len(set.Working) != Frames {
		t.Fatalf("want %d frames, got %d", Frames, len(set.Working))
	}
	for name, icon := range map[string][]byte{
		"idle": set.Idle, "settled": set.Settled, "failed": set.Failed,
	} {
		if len(icon) < 32 {
			t.Errorf("%s icon is too short to be an ICO: %d bytes", name, len(icon))
		}
	}
}

// The states have to LOOK different, not merely exist.
//
// Comparing the bytes is the whole point: a tint that silently did nothing, or
// a rotation that produced the same image twelve times, would pass every test
// that only counts frames, and would then say nothing at all in the one place
// this feature exists for.
func TestEveryTrayStateLooksDifferent(t *testing.T) {
	set, err := BuildTraySet(sample(t))
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if bytes.Equal(set.Idle, set.Settled) {
		t.Error("the settled icon is identical to the idle one, so green says nothing")
	}
	if bytes.Equal(set.Idle, set.Failed) {
		t.Error("the failed icon is identical to the idle one, so red says nothing")
	}
	if bytes.Equal(set.Settled, set.Failed) {
		t.Error("settled and failed are the same image, so the colour carries no meaning")
	}
	// A quarter turn on a ring that is not rotationally symmetric must differ;
	// comparing neighbours would be the weaker check, because a rotation that
	// only ever produced a one pixel shift would still pass it.
	if bytes.Equal(set.Working[0], set.Working[Frames/4]) {
		t.Error("a quarter turn produced the same image, so the icon does not spin")
	}
}

// The tint has to be the colour it was asked for, not merely a different one.
func TestTintCarriesTheColourItWasGiven(t *testing.T) {
	src, err := png.Decode(bytes.NewReader(sample(t)))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	green := tinted(src, settledInk)

	var greener, opaque int
	b := src.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if _, _, _, a := src.At(x, y).RGBA(); a == 0 {
				continue
			}
			opaque++
			r, g, bl, _ := green.At(x, y).RGBA()
			if g > r && g > bl {
				greener++
			}
		}
	}
	if opaque == 0 {
		t.Fatal("the sample has no visible pixels, so this proves nothing")
	}
	if greener != opaque {
		t.Errorf("green tint left %d of %d visible pixels not greenest", opaque-greener, opaque)
	}
}

// Transparency survives the tint.
//
// A tinted icon whose ground turned opaque is a coloured square in the
// notification area, which is worse than no state at all: it reads as a
// different program.
func TestTintLeavesTheGroundTransparent(t *testing.T) {
	src, err := png.Decode(bytes.NewReader(sample(t)))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	out := tinted(src, failedInk)
	b := src.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			_, _, _, was := src.At(x, y).RGBA()
			_, _, _, now := out.At(x, y).RGBA()
			if was == 0 && now != 0 {
				t.Fatalf("pixel %d,%d was transparent and is not any more", x, y)
			}
		}
	}
}
