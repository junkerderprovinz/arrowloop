package remotes

import (
	rclonefs "github.com/rclone/rclone/fs"
)

// needsObscure reports whether rclone stores this option obscured for this
// backend, which is the only reason to obscure it.
//
// rclone obscures exactly the options a backend declares IsPassword and reads
// everything else verbatim. S3's secret_access_key is only Sensitive, so
// obscuring it because its name looks secret produces "Invalid signature". An
// unknown backend or option returns false, because a plain value can be fixed
// by editing it and an obscured one rclone never reveals cannot.
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
