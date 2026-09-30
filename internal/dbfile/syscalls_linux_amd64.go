//go:build linux && amd64

package dbfile

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/unix"
	"modernc.org/libc"
	sqlite3 "modernc.org/sqlite/lib"
)

// atCalls maps the names in SQLite's syscall table to their replacements.
var atCalls = map[string]uintptr{
	"open":     cfunc(open),
	"access":   cfunc(access),
	"stat":     cfunc(stat),
	"lstat":    cfunc(lstat),
	"unlink":   cfunc(unlink),
	"mkdir":    cfunc(mkdir),
	"rmdir":    cfunc(rmdir),
	"readlink": cfunc(readlink),
}

// The C library under the SQLite driver makes the old path syscalls on amd64
// (open, stat, lstat and the like), and Android's seccomp filter kills an app
// process on the first of them. SQLite lets a program replace the calls its
// unix VFS makes, so these go through the *at syscalls, which every Linux
// kernel has.
func init() {
	tls := libc.NewTLS()
	defer tls.Close()

	vfs := sqlite3.Xsqlite3_vfs_find(tls, 0)
	set := *(*func(*libc.TLS, uintptr, uintptr, uintptr) int32)(unsafe.Pointer(&struct{ uintptr }{
		(*sqlite3.Tsqlite3_vfs)(ptr(vfs)).FxSetSystemCall,
	}))
	for name, fn := range atCalls {
		cname, err := libc.CString(name)
		if err != nil {
			panic(err)
		}
		rc := set(tls, vfs, cname, fn)
		libc.Xfree(tls, cname)
		if rc != sqlite3.SQLITE_OK {
			panic(fmt.Sprintf("sqlite: replacing the %s call failed with code %d", name, rc))
		}
	}
}

// cfunc turns a Go function into the pointer SQLite stores in its syscall
// table, which the transpiled code calls back as a Go function value.
func cfunc[T any](f T) uintptr {
	return *(*uintptr)(unsafe.Pointer(&f))
}

// ptr turns an address in libc's memory into a pointer. The collector never
// moves or frees that memory, which is what makes the conversion safe.
func ptr(p uintptr) unsafe.Pointer {
	return *(*unsafe.Pointer)(unsafe.Pointer(&p))
}

// fail sets errno the way the C callers expect and returns their error value.
func fail(tls *libc.TLS, err error) int32 {
	*(*int32)(ptr(libc.X__errno_location(tls))) = int32(err.(unix.Errno))
	return -1
}

func open(tls *libc.TLS, path uintptr, flags, mode int32) int32 {
	fd, err := unix.Openat(unix.AT_FDCWD, libc.GoString(path), int(flags), uint32(mode))
	if err != nil {
		return fail(tls, err)
	}
	return int32(fd)
}

func access(tls *libc.TLS, path uintptr, mode int32) int32 {
	if err := unix.Faccessat(unix.AT_FDCWD, libc.GoString(path), uint32(mode), 0); err != nil {
		return fail(tls, err)
	}
	return 0
}

func stat(tls *libc.TLS, path, buf uintptr) int32 {
	return fstatat(tls, path, buf, 0)
}

func lstat(tls *libc.TLS, path, buf uintptr) int32 {
	return fstatat(tls, path, buf, unix.AT_SYMLINK_NOFOLLOW)
}

// fstatat fills a C struct stat, which on amd64 has the kernel's layout.
func fstatat(tls *libc.TLS, path, buf uintptr, flags int) int32 {
	if err := unix.Fstatat(unix.AT_FDCWD, libc.GoString(path), (*unix.Stat_t)(ptr(buf)), flags); err != nil {
		return fail(tls, err)
	}
	return 0
}

func unlink(tls *libc.TLS, path uintptr) int32 {
	if err := unix.Unlinkat(unix.AT_FDCWD, libc.GoString(path), 0); err != nil {
		return fail(tls, err)
	}
	return 0
}

func mkdir(tls *libc.TLS, path uintptr, mode uint32) int32 {
	if err := unix.Mkdirat(unix.AT_FDCWD, libc.GoString(path), mode); err != nil {
		return fail(tls, err)
	}
	return 0
}

func rmdir(tls *libc.TLS, path uintptr) int32 {
	if err := unix.Unlinkat(unix.AT_FDCWD, libc.GoString(path), unix.AT_REMOVEDIR); err != nil {
		return fail(tls, err)
	}
	return 0
}

func readlink(tls *libc.TLS, path, buf uintptr, size uint64) int64 {
	n, err := unix.Readlinkat(unix.AT_FDCWD, libc.GoString(path), unsafe.Slice((*byte)(ptr(buf)), size))
	if err != nil {
		return int64(fail(tls, err))
	}
	return int64(n)
}
