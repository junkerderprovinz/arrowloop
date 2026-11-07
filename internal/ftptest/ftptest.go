// Package ftptest serves a folder over FTP for tests, with a cap on the logins
// it takes at once like the one the FTP server apps on phones have. It speaks
// just enough of the protocol for rclone to list the folder.
package ftptest

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rclone/rclone/fs/config/obscure"
)

// The account the server lets in.
const (
	User     = "tester"
	Password = "secret"
)

// Refusal is what the server answers a login beyond its cap with, in the words
// of Apache FtpServer, which many of the phone apps are built on.
const Refusal = "421 Maximum login limit has been reached."

// Server is an FTP server over a folder.
type Server struct {
	root string
	most int
	// Each listing waits this long before it answers, so that listings
	// rclone runs side by side overlap as they do over Wi-Fi.
	slow time.Duration

	port string

	mu       sync.Mutex
	loggedIn int
	peak     int
	refused  int
}

// Start serves root until the test ends, letting at most most logins in at
// once, or any number for 0.
func Start(t testing.TB, root string, most int) *Server {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { listener.Close() })
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	s := &Server{root: root, most: most, slow: 50 * time.Millisecond, port: port}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go s.serve(conn)
		}
	}()
	return s
}

// Settings are a target's settings for this server, the password in plain
// text as a person types it into the form.
func (s *Server) Settings() map[string]string {
	return map[string]string{"host": "127.0.0.1", "port": s.port, "user": User, "pass": Password}
}

// Remote is an rclone remote that reaches the server without a configured
// target.
func (s *Server) Remote(t testing.TB) string {
	t.Helper()
	pass, err := obscure.Obscure(Password)
	if err != nil {
		t.Fatalf("obscure: %v", err)
	}
	return fmt.Sprintf(":ftp,host=127.0.0.1,port=%s,user=%s,pass=%s:", s.port, User, pass)
}

// LoggedIn is how many logins are open right now.
func (s *Server) LoggedIn() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loggedIn
}

// Peak is the most logins that were open at the same time.
func (s *Server) Peak() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.peak
}

// Refused is how many logins were turned away for the cap.
func (s *Server) Refused() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.refused
}

func (s *Server) login() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.most > 0 && s.loggedIn >= s.most {
		s.refused++
		return false
	}
	s.loggedIn++
	s.peak = max(s.peak, s.loggedIn)
	return true
}

func (s *Server) logout() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.loggedIn--
}

// session is one control connection.
type session struct {
	s    *Server
	in   *bufio.Reader
	out  net.Conn
	user string
	// data waits for the client to open the connection the next listing
	// goes over.
	data net.Listener
}

func (s *Server) serve(conn net.Conn) {
	defer conn.Close()
	c := &session{s: s, in: bufio.NewReader(conn), out: conn}
	defer func() {
		if c.data != nil {
			c.data.Close()
		}
	}()
	loggedIn := false
	defer func() {
		if loggedIn {
			s.logout()
		}
	}()

	c.reply("220 ready")
	for {
		line, err := c.in.ReadString('\n')
		if err != nil {
			return
		}
		verb, arg, _ := strings.Cut(strings.TrimRight(line, "\r\n"), " ")
		switch strings.ToUpper(verb) {
		case "USER":
			c.user = arg
			c.reply("331 password please")
		case "PASS":
			if c.user != User || arg != Password {
				c.reply("530 Login incorrect.")
				continue
			}
			if !s.login() {
				c.reply(Refusal)
				return
			}
			loggedIn = true
			c.reply("230 logged in")
		case "QUIT":
			c.reply("221 bye")
			return
		case "FEAT":
			c.reply("211-Features:\r\n MLST type*;size*;modify*;\r\n EPSV\r\n UTF8\r\n211 End")
		case "TYPE", "OPTS", "NOOP":
			c.reply("200 ok")
		case "EPSV":
			c.passive()
		case "MLSD":
			c.list(arg)
		case "MLST":
			c.stat(arg)
		default:
			c.reply("502 not implemented")
		}
	}
}

func (c *session) reply(text string) {
	fmt.Fprintf(c.out, "%s\r\n", text)
}

func (c *session) passive() {
	if c.data != nil {
		c.data.Close()
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		c.reply("425 no data connection")
		return
	}
	c.data = listener
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	c.reply(fmt.Sprintf("229 Entering Extended Passive Mode (|||%s|)", port))
}

func (c *session) local(name string) string {
	return filepath.Join(c.s.root, filepath.FromSlash(path.Clean("/"+name)))
}

func facts(info os.FileInfo) string {
	kind := "file"
	if info.IsDir() {
		kind = "dir"
	}
	return fmt.Sprintf("type=%s;size=%d;modify=%s;", kind, info.Size(), info.ModTime().UTC().Format("20060102150405"))
}

func (c *session) list(dir string) {
	if c.data == nil {
		c.reply("425 use EPSV first")
		return
	}
	listener := c.data
	c.data = nil
	defer listener.Close()

	entries, err := os.ReadDir(c.local(dir))
	if err != nil {
		c.reply("550 no such directory")
		return
	}
	time.Sleep(c.s.slow)
	c.reply("150 here it comes")
	conn, err := listener.Accept()
	if err != nil {
		c.reply("425 no data connection")
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		fmt.Fprintf(conn, "%s %s\r\n", facts(info), e.Name())
	}
	conn.Close()
	c.reply("226 done")
}

func (c *session) stat(name string) {
	info, err := os.Stat(c.local(name))
	if err != nil {
		c.reply("550 no such file")
		return
	}
	c.reply(fmt.Sprintf("250-details\r\n %s %s\r\n250 End", facts(info), name))
}
