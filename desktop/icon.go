package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

// Windows wants an ICO in the notification area, and the one master this
// program has is a PNG.
//
// Rather than committing a second file, the ICO is built around the PNG at
// startup. Since Windows Vista an ICO entry may hold a PNG verbatim, so the
// whole conversion is a twenty-two byte header in front of bytes that are
// already there. That matters more than the saving: a second icon file is a
// second thing to remember when the logo changes, and the day somebody forgets
// is the day the window and the notification area wear different marks.
//
// Found by running it: systray reported "unable to set icon" followed by
// Windows' own "the operation completed successfully", which is what
// GetLastError says when nothing failed at the system call level and the
// argument was simply the wrong shape.

// icoFromPNG wraps PNG bytes in the smallest possible ICO container.
func icoFromPNG(png []byte) ([]byte, error) {
	width, height, err := pngSize(png)
	if err != nil {
		return nil, err
	}

	var out bytes.Buffer
	// ICONDIR: reserved, type 1 (icon), one image.
	binary.Write(&out, binary.LittleEndian, uint16(0))
	binary.Write(&out, binary.LittleEndian, uint16(1))
	binary.Write(&out, binary.LittleEndian, uint16(1))

	// ICONDIRENTRY. A dimension of 256 is written as zero, which is the format's
	// own way of saying "the byte is too small for this number".
	out.WriteByte(byteDim(width))
	out.WriteByte(byteDim(height))
	out.WriteByte(0)                                    // colours in the palette: none, this is true colour
	out.WriteByte(0)                                    // reserved
	binary.Write(&out, binary.LittleEndian, uint16(1))  // colour planes
	binary.Write(&out, binary.LittleEndian, uint16(32)) // bits per pixel
	binary.Write(&out, binary.LittleEndian, uint32(len(png)))
	binary.Write(&out, binary.LittleEndian, uint32(6+16))

	out.Write(png)
	return out.Bytes(), nil
}

func byteDim(n int) byte {
	if n >= 256 {
		return 0
	}
	return byte(n)
}

// pngSize reads the dimensions out of the header chunk.
//
// A PNG begins with an eight byte signature, then the length and type of the
// first chunk, which the format requires to be IHDR, and IHDR opens with two
// big-endian widths. So the numbers are always at the same two offsets, and
// decoding the image to learn its size would be a megabyte of work for eight
// bytes of answer.
func pngSize(png []byte) (int, int, error) {
	const header = 8 + 4 + 4 // signature, chunk length, chunk type
	if len(png) < header+8 {
		return 0, 0, errors.New("the icon is too short to be a PNG")
	}
	if string(png[header-4:header]) != "IHDR" {
		return 0, 0, fmt.Errorf("the icon does not start with a PNG header chunk")
	}
	w := binary.BigEndian.Uint32(png[header : header+4])
	h := binary.BigEndian.Uint32(png[header+4 : header+8])
	if w == 0 || h == 0 {
		return 0, 0, errors.New("the icon reports no size")
	}
	return int(w), int(h), nil
}
