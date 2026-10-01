package watch

import (
	"fmt"
	"path/filepath"
	"sync"
	"unsafe"

	"github.com/fsnotify/fsnotify"
	"golang.org/x/sys/windows"
)

// newSource watches each root with one ReadDirectoryChangesW call that covers
// the whole subtree. A handle per folder, which is what fsnotify keeps, stops
// anybody renaming or moving a folder with subfolders in it, because Windows
// refuses that while anything below the folder is open.
func newSource() (*source, error) {
	t := &subtrees{
		events: make(chan fsnotify.Event, 64),
		errors: make(chan error, 8),
		done:   make(chan struct{}),
		roots:  map[string]*subtree{},
	}
	return &source{
		events:    t.events,
		errors:    t.errors,
		add:       t.add,
		remove:    t.remove,
		close:     t.close,
		recursive: true,
	}, nil
}

// changes is what a watch is told about: everything that can make a sync
// worth running.
const changes = windows.FILE_NOTIFY_CHANGE_FILE_NAME |
	windows.FILE_NOTIFY_CHANGE_DIR_NAME |
	windows.FILE_NOTIFY_CHANGE_ATTRIBUTES |
	windows.FILE_NOTIFY_CHANGE_SIZE |
	windows.FILE_NOTIFY_CHANGE_LAST_WRITE |
	windows.FILE_NOTIFY_CHANGE_CREATION

type subtrees struct {
	events chan fsnotify.Event
	errors chan error
	done   chan struct{}

	mu     sync.Mutex
	roots  map[string]*subtree
	closed bool
	wg     sync.WaitGroup
}

// subtree is one watched root. The buffer and the overlapped structure are
// written by the system while a read is pending, so they live on the heap,
// which the collector does not move.
type subtree struct {
	dir   string
	dirH  windows.Handle
	ready windows.Handle
	stop  windows.Handle
	ov    windows.Overlapped
	buf   []byte
}

func (t *subtrees) add(dir string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return fmt.Errorf("the watcher is closed")
	}
	if _, ok := t.roots[dir]; ok {
		return nil
	}
	p, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return err
	}
	dirH, err := windows.CreateFile(p, windows.FILE_LIST_DIRECTORY,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OVERLAPPED, 0)
	if err != nil {
		return err
	}
	ready, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		windows.CloseHandle(dirH)
		return err
	}
	stop, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		windows.CloseHandle(dirH)
		windows.CloseHandle(ready)
		return err
	}
	s := &subtree{dir: dir, dirH: dirH, ready: ready, stop: stop, buf: make([]byte, 64<<10)}
	t.roots[dir] = s
	t.wg.Add(1)
	go t.read(s)
	return nil
}

// remove stops watching a root. Folders below a root have no watch of their
// own to remove.
func (t *subtrees) remove(dir string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	s, ok := t.roots[dir]
	if !ok {
		return fmt.Errorf("%s is not a watched root", dir)
	}
	delete(t.roots, dir)
	return windows.SetEvent(s.stop)
}

func (t *subtrees) close() error {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil
	}
	t.closed = true
	close(t.done)
	for dir, s := range t.roots {
		windows.SetEvent(s.stop)
		delete(t.roots, dir)
	}
	t.mu.Unlock()

	t.wg.Wait()
	close(t.events)
	close(t.errors)
	return nil
}

// read reports the changes under one root until it is stopped or the root
// can no longer be read, as when it was deleted.
func (t *subtrees) read(s *subtree) {
	defer t.wg.Done()
	defer t.drop(s)

	for {
		s.ov = windows.Overlapped{HEvent: s.ready}
		err := windows.ReadDirectoryChanges(s.dirH, &s.buf[0], uint32(len(s.buf)), true, changes, nil, &s.ov, 0)
		if err != nil {
			t.fail(fmt.Errorf("watch %s: %w", s.dir, err))
			return
		}
		which, err := windows.WaitForMultipleObjects([]windows.Handle{s.ready, s.stop}, false, windows.INFINITE)
		if err != nil || which != windows.WAIT_OBJECT_0 {
			var n uint32
			windows.CancelIoEx(s.dirH, &s.ov)
			windows.GetOverlappedResult(s.dirH, &s.ov, &n, true)
			return
		}
		var n uint32
		err = windows.GetOverlappedResult(s.dirH, &s.ov, &n, false)
		switch {
		case err == windows.ERROR_NOTIFY_ENUM_DIR || (err == nil && n == 0):
			// More changed than the buffer holds. The run lists the whole
			// tree anyway, so one change at the root says enough.
			if !t.send(fsnotify.Event{Name: s.dir, Op: fsnotify.Write}) {
				return
			}
		case err != nil:
			t.fail(fmt.Errorf("watch %s: %w", s.dir, err))
			return
		default:
			if !t.report(s, n) {
				return
			}
		}
	}
}

// drop forgets a root whose reading has ended and closes its handles. The
// stop event is only ever signalled under the lock while the root is listed,
// so it cannot be signalled once closed.
func (t *subtrees) drop(s *subtree) {
	t.mu.Lock()
	if t.roots[s.dir] == s {
		delete(t.roots, s.dir)
	}
	t.mu.Unlock()
	windows.CloseHandle(s.dirH)
	windows.CloseHandle(s.ready)
	windows.CloseHandle(s.stop)
}

// report turns the records the system wrote into events.
func (t *subtrees) report(s *subtree, n uint32) bool {
	for off := uint32(0); off < n; {
		info := (*windows.FileNotifyInformation)(unsafe.Pointer(&s.buf[off]))
		name := windows.UTF16ToString(unsafe.Slice(&info.FileName, info.FileNameLength/2))
		ev := fsnotify.Event{Name: filepath.Join(s.dir, name)}
		switch info.Action {
		case windows.FILE_ACTION_ADDED, windows.FILE_ACTION_RENAMED_NEW_NAME:
			ev.Op = fsnotify.Create
		case windows.FILE_ACTION_REMOVED:
			ev.Op = fsnotify.Remove
		case windows.FILE_ACTION_RENAMED_OLD_NAME:
			ev.Op = fsnotify.Rename
		default:
			ev.Op = fsnotify.Write
		}
		if !t.send(ev) {
			return false
		}
		if info.NextEntryOffset == 0 {
			break
		}
		off += info.NextEntryOffset
	}
	return true
}

// send hands one event on, and reports false once the watcher is closing.
func (t *subtrees) send(ev fsnotify.Event) bool {
	select {
	case t.events <- ev:
		return true
	case <-t.done:
		return false
	}
}

func (t *subtrees) fail(err error) {
	select {
	case t.errors <- err:
	case <-t.done:
	}
}
