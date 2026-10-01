//go:build !windows

package shadow

import (
	"context"
	"errors"
)

const supported = false

var errUnsupported = errors.New("shadow copies exist only on Windows")

func takeCopy(context.Context, string) (string, string, error) { return "", "", errUnsupported }

func dropCopy(context.Context, string) error { return errUnsupported }

func alive(int) bool { return false }
