//go:build linux && amd64

package dbfile

import (
	"context"
	"database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"unsafe"

	"golang.org/x/sys/unix"
)

// androidForbids are the old path syscalls Android's seccomp filter refuses an
// app on x86_64. Of those, bionic's SECCOMP_ALLOWLIST_APP.TXT lets x86_64 keep
// only open and getdents.
var androidForbids = []uint32{
	unix.SYS_STAT, unix.SYS_LSTAT, unix.SYS_ACCESS, unix.SYS_RENAME,
	unix.SYS_MKDIR, unix.SYS_RMDIR, unix.SYS_CREAT, unix.SYS_LINK,
	unix.SYS_UNLINK, unix.SYS_SYMLINK, unix.SYS_READLINK, unix.SYS_CHMOD,
	unix.SYS_CHOWN, unix.SYS_LCHOWN, unix.SYS_UTIME, unix.SYS_MKNOD,
	unix.SYS_UTIMES,
}

// The filter cannot be lifted again, so the database work runs in a copy of
// the test binary, which dies with SIGSYS on a forbidden call as the engine
// does on Android.
func TestSQLiteWorksUnderAndroidsSyscallFilter(t *testing.T) {
	dir := os.Getenv("DBFILE_TEST_FILTERED")
	if dir == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^"+t.Name()+"$", "-test.count=1")
		cmd.Env = append(os.Environ(), "DBFILE_TEST_FILTERED="+t.TempDir())
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("SQLite under Android's filter: %v\n%s", err, out)
		}
		return
	}

	forbid(t, androidForbids)
	ctx := context.Background()
	path := filepath.Join(dir, "state", "check.db")
	if err := EnsureDir(path); err != nil {
		t.Fatal(err)
	}
	// The engine's own settings, so WAL and its shared-memory file are in play.
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_txlock=immediate")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := Stamp(ctx, db, path, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE files (path TEXT PRIMARY KEY); INSERT INTO files VALUES ('a.txt')`); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := db.QueryRowContext(ctx, `SELECT path FROM files`).Scan(&got); err != nil || got != "a.txt" {
		t.Fatalf("read back %q (%v)", got, err)
	}
}

// forbid makes every thread of the process die with SIGSYS on the given
// syscalls.
func forbid(t *testing.T, calls []uint32) {
	t.Helper()
	n := len(calls)
	prog := []unix.SockFilter{{Code: unix.BPF_LD | unix.BPF_W | unix.BPF_ABS, K: 0}}
	for i, nr := range calls {
		prog = append(prog, unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K, K: nr, Jt: uint8(n - i)})
	}
	prog = append(prog,
		unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ALLOW},
		unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_TRAP},
	)

	// no_new_privs is per thread, and the kernel checks it on the one that
	// installs the filter.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := unix.Prctl(unix.PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0); err != nil {
		t.Fatal(err)
	}
	fprog := unix.SockFprog{Len: uint16(len(prog)), Filter: &prog[0]}
	r, _, errno := unix.Syscall(unix.SYS_SECCOMP, unix.SECCOMP_SET_MODE_FILTER, unix.SECCOMP_FILTER_FLAG_TSYNC, uintptr(unsafe.Pointer(&fprog)))
	if errno != 0 || r != 0 {
		t.Fatalf("install the filter: errno %v, thread %d", errno, r)
	}
}
