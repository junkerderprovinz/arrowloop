package main

/*
#include <malloc.h>
*/
import "C"

// releaseWebKit hands back what WebKitGTK keeps once its last window has
// gone. The freed memory of the windows stays with glibc until it is trimmed.
func releaseWebKit() {
	C.malloc_trim(0)
}
