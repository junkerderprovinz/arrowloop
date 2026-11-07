package relay

import "time"

// The limits both ends of a relay connection keep to. They are ParleyPort's,
// so a client never sends what the relay would refuse.

// writeTimeout bounds one frame write.
const writeTimeout = 5 * time.Second

// helloTimeout bounds how long a connection may stay open without having said
// who it is, so a socket that goes quiet cannot hold a goroutine forever.
const helloTimeout = 10 * time.Second

// challengeSize is how many random bytes the challenge a hello signs has.
const challengeSize = 32

// readLimit caps one inbound frame once the hello has passed. The default
// 32 KiB is too small for the job list of a busy instance; a few megabytes
// still keeps one peer from pinning unbounded memory.
const readLimit = 8 << 20

// minKeyLength is the shortest relay key the relay accepts. ArrowLoop derives
// one of 64 hex characters from its phrase.
const minKeyLength = 32

// maxClientsPerKey bounds one key's group on the relay, so a client keeps no
// more siblings than the relay would introduce.
const maxClientsPerKey = 64

// frameOf marshals one outbound frame. Every payload is a protocol.go struct
// that encoding/json cannot fail on.
func frameOf(typ string, data any) []byte {
	b, _ := Encode(typ, data)
	return b
}
