package appdata

// intoInit is the command line that starts exe with args again in init's
// mount namespace, given the namespaces it is in and init is in, or nil where
// it is there already or cannot get there.
func intoInit(self, initNS, nsenter, exe string, args []string) []string {
	if self == "" || initNS == "" || self == initNS || nsenter == "" || exe == "" {
		return nil
	}
	return append([]string{nsenter, "-t", "1", "-m", "--", exe}, args...)
}
