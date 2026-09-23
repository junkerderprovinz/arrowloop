package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/junkerderprovinz/arrowloop/internal/web"
)

// cmdHashPassword prints the value ARROWLOOP_PASSWORD_HASH wants. The password
// comes from standard input rather than a flag, so it never lands in a shell
// history or a process list.
func cmdHashPassword(args []string) error {
	fset := flag.NewFlagSet("hash-password", flag.ExitOnError)
	fset.Usage = func() {
		fmt.Fprintln(fset.Output(), "usage: arrowloop hash-password, then type the password, or pipe it in on one line")
	}
	if err := fset.Parse(args); err != nil {
		return err
	}

	plain, err := readPassword(os.Stdin, os.Stderr)
	if err != nil {
		return err
	}
	hash, err := web.HashPassword(plain)
	if err != nil {
		return err
	}
	fmt.Println(hash)
	return nil
}

// readPassword asks twice without echo at a terminal, since a typo nobody saw
// would lock its author out, and otherwise takes the first line of the input.
func readPassword(in *os.File, prompt io.Writer) (string, error) {
	fd := int(in.Fd())
	if !term.IsTerminal(fd) {
		line, err := bufio.NewReader(in).ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", err
		}
		return strings.TrimRight(line, "\r\n"), nil
	}

	ask := func(label string) (string, error) {
		fmt.Fprint(prompt, label)
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(prompt)
		return string(b), err
	}
	first, err := ask("Password: ")
	if err != nil {
		return "", err
	}
	second, err := ask("Again: ")
	if err != nil {
		return "", err
	}
	if first != second {
		return "", errors.New("the two passwords differ")
	}
	return first, nil
}
