package main

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

// The phone app keeps /api/events open for as long as a screen is showing, and
// restarts the engine whenever the authorities installed in Android's settings
// change. A shutdown that waits for the stream to end on its own takes the
// whole timeout and fails.
func TestShutdownEndsAnOpenEventStream(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	streaming := make(chan struct{})
	server := newHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		close(streaming)
		<-r.Context().Done()
	}))
	go server.Serve(listener)

	resp, err := http.Get("http://" + listener.Addr().String() + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	<-streaming
	go bufio.NewReader(resp.Body).ReadString('\n')

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	began := time.Now()
	if err := server.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if took := time.Since(began); took > time.Second {
		t.Errorf("shutdown took %v with a stream open", took)
	}
}
