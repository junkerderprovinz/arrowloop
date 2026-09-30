//go:build linux && amd64

package dbfile

import (
	"testing"
	"unsafe"

	"modernc.org/libc"
	sqlite3 "modernc.org/sqlite/lib"
)

func TestSQLiteMakesItsPathCallsThroughTheAtSyscalls(t *testing.T) {
	tls := libc.NewTLS()
	defer tls.Close()

	vfs := sqlite3.Xsqlite3_vfs_find(tls, 0)
	get := *(*func(*libc.TLS, uintptr, uintptr) uintptr)(unsafe.Pointer(&struct{ uintptr }{
		(*sqlite3.Tsqlite3_vfs)(ptr(vfs)).FxGetSystemCall,
	}))
	for name, want := range atCalls {
		cname, err := libc.CString(name)
		if err != nil {
			t.Fatal(err)
		}
		got := get(tls, vfs, cname)
		libc.Xfree(tls, cname)
		if got != want {
			t.Errorf("SQLite calls its own %s, not the replacement", name)
		}
	}
}
