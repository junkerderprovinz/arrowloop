package remotes

import (
	rclonefs "github.com/rclone/rclone/fs"
)

// WHICH VALUES GET OBSCURED, and why that is a different question from which
// ones get hidden on screen.
//
// These two were one function, keyed on the field's NAME: anything called pass,
// password, secret, key, token, credentials or passphrase was treated as a
// secret, withheld from the screen AND obscured on the way into the config file.
// The first half of that is right. The second half quietly corrupted every S3
// target this program has ever written.
//
// rclone obscures exactly the options a backend declares as `IsPassword`, and
// reads back exactly those. Everything else it stores and reads VERBATIM. S3's
// `secret_access_key` is declared `Sensitive`, which means "do not print this in
// a log", not "this is stored obscured" - so rclone reads whatever stands there
// as the literal secret. ArrowLoop obscured it because the name ends in `_key`,
// and the server on the other end therefore got a signature computed from a
// scrambled string. Garage's own words for that were "Invalid signature", from a
// key ID it recognised perfectly well.
//
// The lesson is the one this house keeps relearning: the name of a thing is not
// the thing. rclone already knows which of its options are passwords, so the
// answer is to ASK IT rather than to keep a second list that agrees with it most
// of the time. A second list is how two halves of one program end up disagreeing
// about what a config file means.

// needsObscure reports whether rclone stores this option obscured for this
// backend, which is the only reason to obscure it.
//
// An unknown backend or an option the backend does not declare returns false:
// writing a value rclone will read verbatim is recoverable by editing it, while
// writing an obscured value it will NOT reveal is a credential that silently
// never works.
func needsObscure(backend, key string) bool {
	info, err := rclonefs.Find(backend)
	if err != nil {
		return false
	}
	for _, option := range info.Options {
		if option.Name == key {
			return option.IsPassword
		}
	}
	return false
}
