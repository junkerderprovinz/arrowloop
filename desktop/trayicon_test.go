package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// sample is a gold ring on a transparent ground, standing in for the real mark.
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
		"paused": set.Paused, "turning": set.Working[3],
	} {
		img, err := png.Decode(bytes.NewReader(icon))
		if err != nil {
			t.Errorf("%s icon is not a PNG: %v", name, err)
			continue
		}
		if b := img.Bounds(); b.Dx() != traySize || b.Dy() != traySize {
			t.Errorf("%s icon is %dx%d, not the %d pixels the tray is drawn from", name, b.Dx(), b.Dy(), traySize)
		}
	}
}

// The shipped logo, since a sample that decodes proves nothing about the file
// the executable carries.
func TestTheTrayIconIsBuiltFromTheOneLogo(t *testing.T) {
	if _, err := BuildTraySet(appIcon); err != nil {
		t.Fatalf("the shipped logo does not give a tray icon: %v", err)
	}
}

func TestThePausedIconCarriesItsBadge(t *testing.T) {
	set, err := BuildTraySet(sample(t))
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if bytes.Equal(set.Idle, set.Paused) {
		t.Fatal("the paused icon is identical to the idle one, so a pause is invisible")
	}
	img, err := png.Decode(bytes.NewReader(set.Paused))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	// The badge sits in the lower right corner, where the sample ring has no ink.
	r, g, b, a := img.At(traySize-4, traySize-traySize/8).RGBA()
	if a == 0 || (r == g && g == b) {
		t.Errorf("no coloured badge in the corner: %d %d %d %d", r>>8, g>>8, b>>8, a>>8)
	}
}

// A tint that did nothing, or a rotation that produced the same image twelve
// times, would pass a test that only counts frames.
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
	// A quarter turn rather than neighbouring frames, which a one pixel shift
	// would already tell apart.
	if bytes.Equal(set.Working[0], set.Working[Frames/4]) {
		t.Error("a quarter turn produced the same image, so the icon does not spin")
	}
}

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
