// Package shadow reads files another program holds open from a shadow copy of
// their volume: a frozen view Windows keeps beside the live one while the live
// files go on changing. Only Windows has such copies, and only a process with
// administrator rights may take one.
package shadow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
)

// ErrNeedsAdmin is why a shadow copy was not taken for a process without
// administrator rights, which the service has and the desktop app usually
// does not.
var ErrNeedsAdmin = errors.New("taking a shadow copy needs administrator rights")

// Set holds the shadow copies one run has taken, one per volume, each taken the
// first time a file on that volume is found held open. Close removes them.
type Set struct {
	mu     sync.Mutex
	copies map[string]*taken
	ledger string
}

type taken struct {
	id, device string
	err        error
}

// New returns an empty Set that lists each copy it takes in the ledger file
// until the copy is removed, or nil where no shadow copy can be taken at all.
// Sweep reads the ledger to remove what a killed process left behind.
func New(ledger string) *Set {
	if !supported {
		return nil
	}
	return &Set{copies: map[string]*taken{}, ledger: ledger}
}

// create and remove are variables so tests can stand in for WMI, which only
// an administrator may use.
var create, remove = takeCopy, dropCopy

// Root returns a local directory as the shadow copy of its volume shows it.
// A volume whose copy could not be taken keeps answering with that error, so
// a run with a thousand open files does not try a thousand times.
func (s *Set) Root(ctx context.Context, dir string) (string, error) {
	volume, rest, err := split(dir)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.copies[volume]
	if !ok {
		c = &taken{}
		c.id, c.device, c.err = create(ctx, volume)
		// A copy the ledger does not know about could outlive a killed run
		// with nothing left to remove it.
		if c.err == nil {
			if err := note(s.ledger, c.id); err != nil {
				remove(ctx, c.id)
				c.err = fmt.Errorf("note the shadow copy of %s: %w", volume, err)
			}
		}
		s.copies[volume] = c
	}
	if c.err != nil {
		return "", c.err
	}
	return c.device + rest, nil
}

// Close removes every shadow copy the run took. Each one holds disk space on
// its volume for as long as it exists.
func (s *Set) Close(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var errs []error
	for volume, c := range s.copies {
		if c.err == nil {
			if err := remove(ctx, c.id); err != nil {
				errs = append(errs, fmt.Errorf("remove the shadow copy of %s: %w", volume, err))
			} else if err := forget(s.ledger, c.id); err != nil {
				errs = append(errs, err)
			}
		}
		delete(s.copies, volume)
	}
	return errors.Join(errs...)
}

// Sweep removes the copies listed in the ledger whose process is gone, the
// ones a killed or crashed run never removed. Only copies this program noted
// down are touched, never one another program took, and a process that is
// still running keeps its own.
func Sweep(ctx context.Context, ledger string) error {
	if !supported {
		return nil
	}
	ledgerMu.Lock()
	defer ledgerMu.Unlock()
	entries, err := readLedger(ledger)
	if err != nil || len(entries) == 0 {
		return err
	}
	var kept []entry
	var errs []error
	for _, e := range entries {
		if e.PID != os.Getpid() && alive(e.PID) {
			kept = append(kept, e)
			continue
		}
		if err := remove(ctx, e.ID); err != nil {
			errs = append(errs, fmt.Errorf("remove the leftover shadow copy %s: %w", e.ID, err))
			kept = append(kept, e)
		}
	}
	if err := writeLedger(ledger, kept); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

// entry is one copy in the ledger and the process that took it.
type entry struct {
	ID  string `json:"id"`
	PID int    `json:"pid"`
}

// ledgerMu keeps runs going at once from losing each other's entries.
var ledgerMu sync.Mutex

func note(ledger, id string) error {
	ledgerMu.Lock()
	defer ledgerMu.Unlock()
	entries, err := readLedger(ledger)
	if err != nil {
		return err
	}
	return writeLedger(ledger, append(entries, entry{ID: id, PID: os.Getpid()}))
}

func forget(ledger, id string) error {
	ledgerMu.Lock()
	defer ledgerMu.Unlock()
	entries, err := readLedger(ledger)
	if err != nil {
		return err
	}
	kept := entries[:0]
	for _, e := range entries {
		if e.ID != id {
			kept = append(kept, e)
		}
	}
	return writeLedger(ledger, kept)
}

func readLedger(ledger string) ([]entry, error) {
	b, err := os.ReadFile(ledger)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read the shadow copy ledger: %w", err)
	}
	var entries []entry
	if err := json.Unmarshal(b, &entries); err != nil {
		return nil, fmt.Errorf("read the shadow copy ledger %s: %w", ledger, err)
	}
	return entries, nil
}

// writeLedger removes the file once it is empty, so a machine that never
// needed a shadow copy has no ledger lying about.
func writeLedger(ledger string, entries []entry) error {
	if len(entries) == 0 {
		if err := os.Remove(ledger); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("clear the shadow copy ledger: %w", err)
		}
		return nil
	}
	b, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(ledger, b, 0o644); err != nil {
		return fmt.Errorf("write the shadow copy ledger: %w", err)
	}
	return nil
}

// split takes a drive path apart into its volume, "C:", and the rest,
// "\Users\me". The extended-length prefix rclone uses is accepted.
func split(dir string) (volume, rest string, err error) {
	p := strings.ReplaceAll(dir, "/", `\`)
	p = strings.TrimPrefix(p, `\\?\`)
	if len(p) < 2 || p[1] != ':' || !isLetter(p[0]) {
		return "", "", fmt.Errorf("%s is not on a local drive, and only a drive has shadow copies", dir)
	}
	rest = p[2:]
	if !strings.HasPrefix(rest, `\`) {
		rest = `\` + rest
	}
	return strings.ToUpper(p[:2]), strings.TrimSuffix(rest, `\`), nil
}

func isLetter(b byte) bool { return (b|0x20) >= 'a' && (b|0x20) <= 'z' }
