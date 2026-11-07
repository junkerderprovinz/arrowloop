package web

// Pairing, as in KnightLoader and BombVault: one instance makes a phrase of
// twelve words, the others enter it, and from then on they meet on the relay
// and call each other's API there, sealed under a key only the phrase gives
// and signed with a key of each instance's own. Every instance approves every
// other one before it is served, and one taken out of the group has its key
// revoked on every instance.
//
// The relay only ever sees relay.DeriveKey of the secret, so neither its
// operator nor its memory can give back what a person would type.

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/federation"
	"github.com/junkerderprovinz/arrowloop/internal/pairing"
	"github.com/junkerderprovinz/arrowloop/internal/relay"
	"github.com/junkerderprovinz/arrowloop/internal/seedphrase"
)

// pairingRoutes registers what the Pairing tile and the overview ask.
func (s *Server) pairingRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/connect", s.readConnect)
	mux.HandleFunc("PUT /api/connect", s.renameInstance)
	mux.HandleFunc("DELETE /api/connect", s.leaveGroup)
	mux.HandleFunc("POST /api/connect/activate", s.activateGroup)
	mux.HandleFunc("POST /api/connect/join", s.joinGroup)
	mux.HandleFunc("POST /api/connect/reveal", s.revealPhrase)
	mux.HandleFunc("DELETE /api/connect/members/{id}", s.removeMember)
	mux.HandleFunc("POST /api/connect/devices/{id}/approve", s.approveMember)
	mux.HandleFunc("POST /api/connect/devices/{id}/refuse", s.refuseMember)
	mux.HandleFunc("GET /api/relay/config", s.readRelay)
	mux.HandleFunc("PUT /api/relay/config", s.writeRelay)
	mux.HandleFunc("GET /api/instances", s.listInstances)
	mux.HandleFunc("POST /api/instances/{id}/jobs/{name}/{action}", s.instanceJob)
}

// StartPairing dials the relay when this instance is in a group. Call it once
// the server is set up; without a pairing store it does nothing.
func (s *Server) StartPairing() {
	if s.Pairing != nil {
		s.applyRelay()
	}
}

// StopPairing closes the relay connection.
func (s *Server) StopPairing() {
	if s.Group != nil {
		s.Group.SetRelay(nil)
	}
}

// relayTimeout bounds what the interface waits for another instance.
const relayTimeout = 15 * time.Second

// connectInfo is what GET /api/connect answers. It never carries the phrase,
// which only the reveal route hands out.
type connectInfo struct {
	// Active is whether this instance is in a group at all, and Connected
	// whether its relay socket is up right now.
	Active    bool `json:"active"`
	Connected bool `json:"connected"`
	// PasswordSet is whether showing the phrase again asks for the password.
	PasswordSet bool `json:"passwordSet"`
	// RelayMode is "project", "own" or "off", RelayURL the relay dialled now,
	// "" when none, and ProjectRelayURL the project's in every mode.
	RelayMode       string `json:"relayMode"`
	RelayURL        string `json:"relayUrl"`
	ProjectRelayURL string `json:"projectRelayUrl"`
	// Name is what the other instances see this one as, and Deployment what
	// it tells them it is.
	Name       string `json:"name"`
	Deployment string `json:"deployment"`
	// Members is the other instances reachable now, and Away the approved
	// ones that are not.
	Members []groupMember `json:"members"`
	Away    []awayMember  `json:"away"`
	// JoinedAgo is how many seconds ago this instance made or entered its
	// phrase, and MemberSeen whether another instance has shown up since.
	// Together they tell a group waiting for its second instance from one
	// that never forms.
	JoinedAgo  int64 `json:"joinedAgo"`
	MemberSeen bool  `json:"memberSeen"`
	// Pending is every instance whose key waits for approval here, and
	// Awaiting whether another instance said lately that this one waits there.
	Pending  []pendingMember `json:"pending"`
	Awaiting bool            `json:"awaiting"`
	// Fingerprint is this instance's own key as the others list it while it
	// waits for approval there, "" outside a group.
	Fingerprint string `json:"fingerprint"`
}

type groupMember struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Deployment string `json:"deployment"`
	Address    string `json:"address,omitempty"`
	// Approved is whether this instance let the member in.
	Approved bool `json:"approved"`
}

type awayMember struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Deployment string `json:"deployment"`
	Address    string `json:"address,omitempty"`
	// LastSeen is Unix seconds.
	LastSeen int64 `json:"lastSeen"`
}

type pendingMember struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Fingerprint string `json:"fingerprint"`
}

func (s *Server) readConnect(w http.ResponseWriter, _ *http.Request) {
	// The tile asks this while it is open, which is when the instances of a
	// group have to meet to be approved on each other.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*relayTimeout)
		defer cancel()
		s.Group.Greet(ctx, time.Now())
	}()
	writeJSON(w, http.StatusOK, s.connectInfo())
}

func (s *Server) connectInfo() connectInfo {
	st := s.Pairing.Get()
	now := time.Now()
	members := s.Group.Members()
	names := map[string]string{}
	info := connectInfo{
		Active:          st.Secret != nil,
		Connected:       s.Group.RelayConnected(),
		PasswordSet:     len(s.passwordHash()) > 0,
		RelayMode:       st.Mode(),
		RelayURL:        relayTarget(st),
		ProjectRelayURL: relay.DefaultRelayURL,
		Name:            s.instanceName(st),
		Deployment:      s.Deployment,
		Members:         []groupMember{},
		Away:            []awayMember{},
		Pending:         []pendingMember{},
		Awaiting:        s.Group.AwaitingApproval(now),
	}
	for _, m := range members {
		names[m.ID] = m.Name
		info.Members = append(info.Members, groupMember{ID: m.ID, Name: m.Name, Deployment: m.Deployment, Address: m.Address, Approved: s.Group.Approved(m.ID)})
	}
	away, err := s.Group.AwayMembers(now)
	if err != nil {
		s.logf("pairing: could not record the instances of the group: %v", err)
	}
	for _, m := range away {
		names[m.ID] = m.Name
		info.Away = append(info.Away, awayMember{ID: m.ID, Name: m.Name, Deployment: m.Deployment, Address: m.Address, LastSeen: m.LastSeen.Unix()})
	}
	for _, p := range s.Group.PendingMembers() {
		info.Pending = append(info.Pending, pendingMember{ID: p.ID, Name: names[p.ID], Fingerprint: p.Fingerprint})
	}
	sort.Slice(info.Pending, func(i, j int) bool { return info.Pending[i].ID < info.Pending[j].ID })

	group, err := s.Group.Group(len(members) > 0, now)
	if err != nil {
		s.logf("pairing: could not record the first member of the group: %v", err)
	}
	if !group.JoinedAt.IsZero() {
		info.JoinedAgo = max(int64(now.Sub(group.JoinedAt).Seconds()), 0)
	}
	info.MemberSeen = !group.MemberSeenAt.IsZero()
	if member := s.memberKey(); member != nil {
		info.Fingerprint = relay.Fingerprint(member.Public().(ed25519.PublicKey))
	}
	return info
}

// instanceName is what the other instances see this one as: the name given on
// the Pairing tile, else the machine's.
func (s *Server) instanceName(st pairing.State) string {
	if name := strings.TrimSpace(st.Name); name != "" {
		return name
	}
	host, _ := os.Hostname()
	return host
}

// maxInstanceName keeps a name inside what the relay lets an announce carry.
const maxInstanceName = 64

func (s *Server) renameInstance(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !readBody(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if len([]rune(name)) > maxInstanceName {
		writeError(w, http.StatusBadRequest, fmt.Errorf("a name has at most %d characters", maxInstanceName))
		return
	}
	if err := s.Pairing.Update(func(st *pairing.State) error { st.Name = name; return nil }); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.applyRelay()
	writeJSON(w, http.StatusOK, s.connectInfo())
}

func (s *Server) activateGroup(w http.ResponseWriter, r *http.Request) {
	// Replacing a secret would leave every instance joined to the old phrase
	// behind; leaving is a DELETE of its own.
	if s.Pairing.Get().Secret != nil {
		writeJSON(w, http.StatusConflict, map[string]string{
			"code":  "phraseExists",
			"error": "this instance already has a phrase; leave the group first to start a new one",
		})
		return
	}
	secret, phrase, err := seedphrase.New()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if err := s.enterGroup(secret); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"phrase": phrase, "code": s.pairingCode(phrase), "info": s.connectInfo()})
}

func (s *Server) joinGroup(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phrase string `json:"phrase"`
	}
	if !readBody(w, r, &req) {
		return
	}
	// A code read from another instance's QR names its own relay on a second
	// line, and the words come first.
	words, own, _ := strings.Cut(strings.TrimSpace(req.Phrase), "\n")
	secret, err := seedphrase.Decode(words)
	if err != nil {
		// The reason and its details rather than a sentence, so the interface
		// can explain the mistyped word in the reader's language.
		var de *seedphrase.DecodeError
		if errors.As(err, &de) {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": de.Error(),
				"code":  string(de.Reason),
				"values": map[string]string{
					"word": de.Word, "position": strconv.Itoa(de.Position), "count": strconv.Itoa(de.Count),
				},
			})
			return
		}
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if own = strings.TrimSpace(own); own != "" {
		if err := checkRelayURL(own); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := s.Pairing.Update(func(st *pairing.State) error {
			st.RelayMode, st.RelayURL = pairing.ModeOwn, own
			return nil
		}); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	if err := s.enterGroup(secret); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, s.connectInfo())
}

// revealPhrase shows the phrase again. A session is not enough when a password
// is set: it may have been left open on a screen nobody watches, and the
// phrase reaches every instance of the group. A wrong password counts against
// the address like a wrong sign-in.
func (s *Server) revealPhrase(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if r.ContentLength != 0 && !readBody(w, r, &req) {
		return
	}
	if len(s.passwordHash()) > 0 && !s.checkCurrentPassword(w, r, req.Password) {
		return
	}
	secret := s.Pairing.Get().Secret
	if secret == nil {
		writeError(w, http.StatusNotFound, errors.New("this instance is in no group"))
		return
	}
	phrase, err := seedphrase.Encode(secret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"phrase": phrase, "code": s.pairingCode(phrase)})
}

func (s *Server) leaveGroup(w http.ResponseWriter, _ *http.Request) {
	if err := s.enterGroup(nil); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pairingCode is the text of the QR code beside a phrase, naming this
// instance's own relay when it dials one (relay.PairingCode).
func (s *Server) pairingCode(phrase string) string {
	st := s.Pairing.Get()
	own := ""
	if st.Mode() == pairing.ModeOwn {
		own = st.RelayURL
	}
	return relay.PairingCode(phrase, own)
}

// enterGroup stores secret as this instance's group, or leaves the group with
// nil, and redials the relay. Either way the group starts over with nobody
// seen in it and nobody approved, under a new member key, which the others
// pin as a new instance.
func (s *Server) enterGroup(secret []byte) error {
	if err := s.Pairing.Update(func(st *pairing.State) error {
		st.Secret, st.Member = secret, nil
		return nil
	}); err != nil {
		return err
	}
	joined := time.Time{}
	if secret != nil {
		joined = time.Now()
	}
	err := s.Group.SetJoined(joined)
	s.applyRelay()
	return err
}

// removeMember takes another instance out of the group on every instance of
// it: its key is revoked, it hears it and leaves, and it comes back as a new
// instance waiting for approval when the phrase is entered there again.
func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == s.groupID() {
		writeError(w, http.StatusBadRequest, errors.New("to leave the group, use DELETE /api/connect"))
		return
	}
	if err := s.Group.RemoveMember(id, time.Now()); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	go s.passOn("", http.MethodDelete, "/api/connect/members/"+url.PathEscape(id), nil)
	w.WriteHeader(http.StatusNoContent)
}

// memberDecision is what an approval carries when it is passed on: the key
// approved and the kind it signs as, so an instance the new one has not called
// yet pins it as approved.
type memberDecision struct {
	Key  []byte `json:"key,omitempty"`
	Kind string `json:"kind,omitempty"`
}

func (s *Server) approveMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	key, kind, err := s.Group.Approve(id, nil, "")
	if !answerApproval(w, err) {
		return
	}
	body, _ := json.Marshal(memberDecision{Key: key, Kind: kind})
	go s.passOn(id, http.MethodPost, "/api/connect/devices/"+url.PathEscape(id)+"/approve", body)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) refuseMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Group.Refuse(id, time.Now()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	go s.passOn(id, http.MethodPost, "/api/connect/devices/"+url.PathEscape(id)+"/refuse", []byte("{}"))
	w.WriteHeader(http.StatusNoContent)
}

// answerApproval answers a failed approval and reports whether there was
// none.
func answerApproval(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, federation.ErrNoSuchPending):
		writeError(w, http.StatusNotFound, err)
	case errors.Is(err, federation.ErrKindMismatch):
		writeError(w, http.StatusBadRequest, err)
	case errors.Is(err, federation.ErrGone):
		writeError(w, http.StatusGone, err)
	case errors.Is(err, federation.ErrKeyMismatch):
		writeError(w, http.StatusConflict, err)
	default:
		writeError(w, http.StatusInternalServerError, err)
	}
	return false
}

// passOn hands a decision about the group's members, made here by the owner,
// to the other instances of the group, signed with this instance's key. skip
// is a member that is not told. One that is away misses it: an instance
// approved here still waits there, and one removed here is still served there.
func (s *Server) passOn(skip, method, path string, body []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*relayTimeout)
	defer cancel()
	for _, m := range s.Group.Members() {
		if m.ID == skip {
			continue
		}
		if _, status, err := s.Group.Proxy(ctx, m.ID, method, path, body); err != nil || status >= 300 {
			s.logf("pairing: could not pass %s %s on to %s: status %d, %v", method, path, m.Name, status, err)
		}
	}
}

// relayView is what the relay routes answer.
type relayView struct {
	Mode            string `json:"mode"`
	RelayURL        string `json:"relayUrl"`
	ProjectRelayURL string `json:"projectRelayUrl"`
	Connected       bool   `json:"connected"`
}

func (s *Server) relayView() relayView {
	st := s.Pairing.Get()
	return relayView{Mode: st.Mode(), RelayURL: st.RelayURL, ProjectRelayURL: relay.DefaultRelayURL, Connected: s.Group.RelayConnected()}
}

func (s *Server) readRelay(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.relayView())
}

func (s *Server) writeRelay(w http.ResponseWriter, r *http.Request) {
	// Pointers, so a save from one control does not carry the other back.
	var req struct {
		Mode     *string `json:"mode"`
		RelayURL *string `json:"relayUrl"`
	}
	if !readBody(w, r, &req) {
		return
	}
	if req.Mode != nil && !pairing.ValidMode(*req.Mode) {
		writeError(w, http.StatusBadRequest, errors.New("the relay mode is project, own or off"))
		return
	}
	if req.RelayURL != nil && strings.TrimSpace(*req.RelayURL) != "" {
		if err := checkRelayURL(*req.RelayURL); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	}
	if err := s.Pairing.Update(func(st *pairing.State) error {
		if req.Mode != nil {
			st.RelayMode = *req.Mode
		}
		if req.RelayURL != nil {
			st.RelayURL = strings.TrimSpace(*req.RelayURL)
		}
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.applyRelay()
	writeJSON(w, http.StatusOK, s.relayView())
}

// checkRelayURL refuses an address the relay client could not dial.
func checkRelayURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return fmt.Errorf("%q is not a relay address", raw)
	}
	switch u.Scheme {
	case "http", "https", "ws", "wss":
		return nil
	}
	return fmt.Errorf("%q has to start with https:// or wss://", raw)
}

// relayTarget is the relay this instance dials, "" for none: switched off, or
// an own relay without an address, which dials nothing rather than falling
// back to the project's.
func relayTarget(st pairing.State) string {
	switch st.Mode() {
	case pairing.ModeOff:
		return ""
	case pairing.ModeOwn:
		return strings.TrimSpace(st.RelayURL)
	}
	return relay.DefaultRelayURL
}

// applyRelay rebuilds the relay client from what is stored and installs it on
// the group, which closes the previous one. A relay that cannot be reached is
// no error here; the client keeps retrying in the background.
func (s *Server) applyRelay() {
	s.relayMu.Lock()
	defer s.relayMu.Unlock()
	st := s.Pairing.Get()
	target := relayTarget(st)
	if st.Secret == nil || target == "" {
		s.Group.SetRelay(nil)
		return
	}
	member := s.memberKey()
	if member == nil {
		s.Group.SetRelay(nil)
		return
	}
	c, err := relay.NewClient(relay.ClientOptions{
		URL:      target,
		Key:      relay.DeriveKey(st.Secret),
		FrameKey: relay.DeriveFrameKey(st.Secret),
		Self: relay.Announce{
			InstanceID: relay.MemberID(relay.KindInstance, member.Public().(ed25519.PublicKey)),
			Name:       s.instanceName(st),
			Deployment: s.Deployment,
		},
		Member: member,
		Trusts: s.Group.TrustsAnswer,
		Serve:  s.Group.Guard(s.serveGroupCall),
		// A member that leaves keeps its card here, written while it was
		// still there. One that arrives is greeted at once, so each owner
		// finds the other waiting for approval without this instance's
		// Pairing tile having to be open.
		OnChange: func() {
			go func() {
				if _, err := s.Group.AwayMembers(time.Now()); err != nil {
					s.logf("pairing: could not record the instances of the group: %v", err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 2*relayTimeout)
				defer cancel()
				s.Group.Greet(ctx, time.Now())
			}()
		},
	})
	if err != nil {
		s.logf("pairing: could not set up the relay client: %v", err)
		s.Group.SetRelay(nil)
		return
	}
	c.Start()
	s.Group.SetRelay(c)
}

// memberKey is the key this instance signs its calls to the group with, nil
// outside a group. It is minted the first time it is needed and belongs to one
// group: entering another mints a new one.
func (s *Server) memberKey() ed25519.PrivateKey {
	s.memberMu.Lock()
	defer s.memberMu.Unlock()
	st := s.Pairing.Get()
	if st.Secret == nil {
		return nil
	}
	if len(st.Member) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(st.Member)
	}
	seed, err := relay.NewMemberSeed()
	if err == nil {
		err = s.Pairing.Update(func(st *pairing.State) error { st.Member = seed; return nil })
	}
	if err != nil {
		s.logf("pairing: no member key, so the group refuses this instance's calls until one can be made: %v", err)
		return nil
	}
	return ed25519.NewKeyFromSeed(seed)
}

// groupID is the id the group knows this instance by, "" outside a group.
func (s *Server) groupID() string {
	member := s.memberKey()
	if member == nil {
		return ""
	}
	return relay.MemberID(relay.KindInstance, member.Public().(ed25519.PublicKey))
}

// serveGroupCall turns one call from another member, already admitted by the
// group's guard, into a request against groupHandler.
func (s *Server) serveGroupCall(ctx context.Context, call relay.ProxyCall) (int, []byte) {
	var body io.Reader
	if len(call.Body) > 0 {
		body = bytes.NewReader(call.Body)
	}
	req, err := http.NewRequestWithContext(ctx, call.Method, call.Path, body)
	if err != nil {
		return http.StatusBadRequest, []byte(err.Error())
	}
	if len(call.Body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := newRelayRecorder()
	// No net/http server is here to recover a panicking handler, and this
	// runs on the goroutine reading relay frames, so a panic would take the
	// whole instance down.
	defer func() {
		if p := recover(); p != nil {
			s.logf("pairing: a handler panicked serving %s %s: %v", call.Method, call.Path, p)
		}
	}()
	s.groupHandler().ServeHTTP(rec, req)
	if rec.tooLong {
		return http.StatusBadGateway, []byte(errRelayAnswerTooLong.Error())
	}
	return rec.status, rec.body.Bytes()
}

// groupHandler is everything another member of the group may ask: the job
// list, starting and stopping a job, and the decisions about members an
// approved instance passes on. Settings, targets, the trash, restoring and the
// phrase stay with the owner at this instance.
func (s *Server) groupHandler() http.Handler {
	s.groupOnce.Do(func() {
		mux := http.NewServeMux()
		mux.HandleFunc("GET "+federation.HelloPath, func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]string{"name": s.instanceName(s.Pairing.Get())})
		})
		mux.HandleFunc("GET /api/jobs", s.listJobs)
		mux.HandleFunc("POST /api/jobs/{name}/run", s.groupRunJob)
		mux.HandleFunc("POST /api/jobs/{name}/stop", s.stopJob)
		mux.HandleFunc("DELETE /api/connect/members/{id}", s.groupRemoveMember)
		mux.HandleFunc("POST /api/connect/devices/{id}/approve", s.groupApproveMember)
		mux.HandleFunc("POST /api/connect/devices/{id}/refuse", s.groupRefuseMember)
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, fmt.Errorf("no such address for the group: %s %s", r.Method, r.URL.Path))
		})
		s.group = mux
	})
	return s.group
}

// groupRunJob starts a whole run, as Run now does. A selection or a choice in
// a conflict is made at the instance itself, where the files are.
func (s *Server) groupRunJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, ok := s.Runner.Config().Find(name); !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}
	go func() {
		_, _ = s.Runner.RunChosen(context.Background(), name, nil, nil, nil)
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"job": name, "status": "started"})
}

// fromApprovedInstance reports whether a call from the group came from an
// instance whose key is pinned and approved here. Only such a call may decide
// who else is in the group.
func (s *Server) fromApprovedInstance(r *http.Request) bool {
	c, ok := federation.CallerOf(r.Context())
	return ok && s.Group.ApprovedInstance(c)
}

func refuseDecision(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, map[string]string{
		"code":  "decisionNotFromInstance",
		"error": "only an approved instance of the group passes an approval, a refusal or a removal on",
	})
}

func (s *Server) groupRemoveMember(w http.ResponseWriter, r *http.Request) {
	if !s.fromApprovedInstance(r) {
		refuseDecision(w)
		return
	}
	id := r.PathValue("id")
	if id == s.groupID() {
		// Answered before the relay socket closes under this call.
		w.WriteHeader(http.StatusNoContent)
		go func() {
			if err := s.enterGroup(nil); err != nil {
				s.logf("pairing: did not leave the group after an instance of it took this one out: %v", err)
			}
		}()
		return
	}
	if err := s.Group.RemoveMember(id, time.Now()); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) groupApproveMember(w http.ResponseWriter, r *http.Request) {
	if !s.fromApprovedInstance(r) {
		refuseDecision(w)
		return
	}
	var passed memberDecision
	if !readBody(w, r, &passed) {
		return
	}
	if passed.Key == nil {
		writeError(w, http.StatusBadRequest, errors.New("an approval passed on carries the key approved"))
		return
	}
	if _, _, err := s.Group.Approve(r.PathValue("id"), passed.Key, passed.Kind); !answerApproval(w, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) groupRefuseMember(w http.ResponseWriter, r *http.Request) {
	if !s.fromApprovedInstance(r) {
		refuseDecision(w)
		return
	}
	if err := s.Group.Refuse(r.PathValue("id"), time.Now()); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// relayAnswerMax bounds what one call from the group answers, which the relay
// carries in a single frame.
const relayAnswerMax = 4 << 20

// relayRecorder buffers one handler's answer in memory, so production code
// does not depend on httptest.
type relayRecorder struct {
	header  http.Header
	status  int
	body    bytes.Buffer
	tooLong bool
}

func newRelayRecorder() *relayRecorder {
	return &relayRecorder{header: http.Header{}, status: http.StatusOK}
}

// errRelayAnswerTooLong stops a handler that writes past relayAnswerMax.
var errRelayAnswerTooLong = errors.New("the answer is too large to pass on")

func (r *relayRecorder) Header() http.Header    { return r.header }
func (r *relayRecorder) WriteHeader(status int) { r.status = status }

func (r *relayRecorder) Write(b []byte) (int, error) {
	if r.tooLong || r.body.Len()+len(b) > relayAnswerMax {
		r.tooLong = true
		return 0, errRelayAnswerTooLong
	}
	return r.body.Write(b)
}

// instanceView is one other instance as the overview shows it.
type instanceView struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Deployment string `json:"deployment"`
	Address    string `json:"address,omitempty"`
	// State is "ok" with Jobs, "approve" while it waits for approval here,
	// "waiting" while this instance waits for approval there, "away" when the
	// relay does not see it, and "error" when it did not answer.
	State string            `json:"state"`
	Jobs  []json.RawMessage `json:"jobs,omitempty"`
	// LastSeen is Unix seconds, for an instance that is away.
	LastSeen int64  `json:"lastSeen,omitempty"`
	Error    string `json:"error,omitempty"`
}

// listInstances asks every other instance of the group for its jobs, side by
// side, so one that is slow does not hold up the others.
func (s *Server) listInstances(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	members := s.Group.Members()
	pending := map[string]bool{}
	for _, p := range s.Group.PendingMembers() {
		pending[p.ID] = true
	}
	out := make([]instanceView, len(members))
	var wg sync.WaitGroup
	for i, m := range members {
		out[i] = instanceView{ID: m.ID, Name: m.Name, Deployment: m.Deployment, Address: m.Address}
		if pending[m.ID] {
			out[i].State = "approve"
			continue
		}
		wg.Go(func() {
			ctx, cancel := context.WithTimeout(r.Context(), relayTimeout)
			defer cancel()
			out[i].State, out[i].Jobs, out[i].Error = s.memberJobs(ctx, m.ID)
		})
	}
	wg.Wait()
	away, err := s.Group.AwayMembers(now)
	if err != nil {
		s.logf("pairing: could not record the instances of the group: %v", err)
	}
	for _, m := range away {
		out = append(out, instanceView{ID: m.ID, Name: m.Name, Deployment: m.Deployment, Address: m.Address, State: "away", LastSeen: m.LastSeen.Unix()})
	}
	writeJSON(w, http.StatusOK, out)
}

// memberJobs is one member's job list, or why there is none.
func (s *Server) memberJobs(ctx context.Context, id string) (string, []json.RawMessage, string) {
	body, status, err := s.Group.Proxy(ctx, id, http.MethodGet, "/api/jobs", nil)
	var untrusted *relay.UntrustedAnswer
	switch {
	case errors.As(err, &untrusted) && untrusted.Status == http.StatusForbidden && bytes.Contains(untrusted.Body, []byte(`"memberPending"`)):
		return "waiting", nil, ""
	case err != nil:
		return "error", nil, err.Error()
	case status == http.StatusForbidden && bytes.Contains(body, []byte(`"memberPending"`)):
		return "waiting", nil, ""
	case status != http.StatusOK:
		return "error", nil, fmt.Sprintf("it answered %d: %s", status, strings.TrimSpace(string(body)))
	}
	var jobs []json.RawMessage
	if err := json.Unmarshal(body, &jobs); err != nil {
		return "error", nil, fmt.Sprintf("its job list does not read: %v", err)
	}
	if jobs == nil {
		jobs = []json.RawMessage{}
	}
	return "ok", jobs, ""
}

// instanceJob starts or stops a job on another instance of the group.
func (s *Server) instanceJob(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	if action != "run" && action != "stop" {
		writeError(w, http.StatusNotFound, fmt.Errorf("a job on another instance can be run or stopped, not %q", action))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), relayTimeout)
	defer cancel()
	path := "/api/jobs/" + url.PathEscape(r.PathValue("name")) + "/" + action
	body, status, err := s.Group.Proxy(ctx, r.PathValue("id"), http.MethodPost, path, nil)
	if err != nil {
		code := http.StatusBadGateway
		if errors.Is(err, federation.ErrUnknownInstance) {
			code = http.StatusNotFound
		}
		writeError(w, code, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
