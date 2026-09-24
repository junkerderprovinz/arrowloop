//go:build !windows

package shadow

import (
	"context"
	"errors"
)

const supported = false

var errUnsupported = errors.New("shadow copies exist only on Windows")

func create(context.Context, string) (string, string, error) { return "", "", errUnsupported }

func remove(context.Context, string) error { return errUnsupported }
