package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

// icoFromPNG wraps PNG bytes in the smallest possible ICO container, which the
// Windows notification area needs. Since Vista an ICO entry may hold a PNG
// verbatim, so one logo file serves both.
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

	// ICONDIRENTRY. The format writes a dimension of 256 as zero.
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

// pngSize reads the dimensions out of the IHDR chunk, which the format requires
// to come first, so they sit at fixed offsets.
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
