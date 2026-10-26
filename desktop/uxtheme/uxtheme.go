// Package uxtheme keeps uxtheme.dll loaded on Windows for the life of the
// process.
//
// Wails looks up the dark mode functions of uxtheme.dll by ordinal while it
// initialises and then frees the library. Where nothing else holds it, as on
// Windows build 26300, the first window calls into unmapped memory. Go
// initialises this package before Wails' w32: neither imports the other, and
// this one sorts first by import path.
package uxtheme
