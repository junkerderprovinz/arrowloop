package main

import (
	"encoding/binary"
	"testing"
)

// TestTheTrayIconIsBuiltFromTheOneLogo.
//
// Windows draws an ICO in the notification area and this program has one master
// and it is a PNG. Committing a second file would work and would be the thing
// somebody forgets to change the day the logo changes, so the container is
// built around the same bytes instead. What that costs is a header, and this is
// the test that the header is the right shape: it was wrong once, and the only
// symptom was systray saying "unable to set icon" followed by Windows saying
// the operation completed successfully.
func TestTheTrayIconIsBuiltFromTheOneLogo(t *testing.T) {
	ico, err := icoFromPNG(trayIcon)
	if err != nil {
		t.Fatalf("the shipped logo could not be wrapped: %v", err)
	}
	if len(ico) != len(trayIcon)+22 {
		t.Fatalf("the container is %d bytes around a %d byte image, expected a 22 byte header",
			len(ico)-len(trayIcon), len(trayIcon))
	}
	if binary.LittleEndian.Uint16(ico[2:4]) != 1 {
		t.Error("the type field does not say icon")
	}
	if binary.LittleEndian.Uint16(ico[4:6]) != 1 {
		t.Error("the directory does not hold exactly one image")
	}
	if got := binary.LittleEndian.Uint32(ico[14:18]); int(got) != len(trayIcon) {
		t.Errorf("the entry claims %d bytes of image, the image is %d", got, len(trayIcon))
	}
	if got := binary.LittleEndian.Uint32(ico[18:22]); got != 22 {
		t.Errorf("the image is said to start at %d rather than straight after the header", got)
	}
	if string(ico[22:26]) != string(trayIcon[:4]) {
		t.Error("the bytes after the header are not the image")
	}
}

// TestASquareLogoIsNotSilentlyMisreported. A 256 pixel side is written as zero,
// which is the format saying the byte is too small for the number, and reading
// that rule backwards would ship an icon claiming to be zero pixels across.
func TestASquareLogoIsNotSilentlyMisreported(t *testing.T) {
	width, height, err := pngSize(trayIcon)
	if err != nil {
		t.Fatalf("the shipped logo has no readable size: %v", err)
	}
	if width == 0 || height == 0 {
		t.Fatal("the logo reports no size at all")
	}
	ico, err := icoFromPNG(trayIcon)
	if err != nil {
		t.Fatalf("wrap: %v", err)
	}
	want := byte(0)
	if width < 256 {
		want = byte(width)
	}
	if ico[6] != want {
		t.Errorf("a %d pixel side was written as %d", width, ico[6])
	}
}

// TestSomethingThatIsNotAPNGIsRefused, rather than producing a container around
// bytes nothing can draw.
func TestSomethingThatIsNotAPNGIsRefused(t *testing.T) {
	for _, bad := range [][]byte{nil, []byte("short"), make([]byte, 64)} {
		if _, err := icoFromPNG(bad); err == nil {
			t.Errorf("%d bytes of nothing were accepted as an image", len(bad))
		}
	}
}
