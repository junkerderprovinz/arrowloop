package web

// Pairing, as in KnightLoader and BombVault: one instance makes a phrase of
// twelve words, the others enter it, and from then on they call each other's
// API, directly on one network and over the relay elsewhere, sealed under a
// key only the phrase gives and signed with a key of each instance's own.
// Every instance approves every other one before it is served, and one taken
// out of the group has its key revoked on every instance. The kit's group does
// all of that; this file is what ArrowLoop puts around it.

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	kitfortress "github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/member"
	"github.com/junkerderprovinz/parleyport/kit/phrase"
	"github.com/junkerderprovinz/parleyport/kit/relay"

	"github.com/junkerderprovinz/arrowloop/internal/pairing"
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
	// Open like a relay of its own: the relay key in the first frame is the
	// credential, and nothing but this group's key gets in.
	mux.HandleFunc("GET "+servedRelayPath, s.serveRelay)
	mux.HandleFunc("GET /api/instances", s.listInstances)
	mux.HandleFunc("POST /api/instances/{id}/jobs/{name}/{action}", s.instanceJob)
	mux.HandleFunc("GET /api/instances/{id}/jobs/{name}/config", s.instanceJobConfig)
	mux.HandleFunc("PUT /api/instances/{id}/jobs/{name}/config", s.instanceJobConfig)
	mux.HandleFunc("GET /api/instances/{id}/places", s.instancePlaces)
	mux.HandleFunc("GET /api/instances/{id}/browse", s.instanceBrowse)
}

// StartPairing joins the group this instance is in. Call it once the server
// is set up; without a pairing store it does nothing.
func (s *Server) StartPairing() {
	if s.Pairing == nil {
		return
	}
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	s.openGroupLocked()
}

// StopPairing leaves the relay and the network.
func (s *Server) StopPairing() {
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	s.closeGroupLocked()
}

// relayTimeout bounds what the interface waits for another instance.
const relayTimeout = 15 * time.Second

// joined is the group this instance is in, nil outside one.
func (s *Server) joined() *group.Group {
	s.liveMu.Lock()
	defer s.liveMu.Unlock()
	return s.live
}

// generation counts the groups opened, so a group that heard this instance
// was taken out acts only while it is still the one in use.
func (s *Server) generation() uint64 {
	s.liveMu.Lock()
	defer s.liveMu.Unlock()
	return s.liveGen
}

// applyGroup opens the group again on what is stored now. The kit takes the
// name and the relay only when a group opens.
func (s *Server) applyGroup() {
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	s.closeGroupLocked()
	s.openGroupLocked()
}

func (s *Server) closeGroupLocked() {
	if s.closeFortressLocked() {
		return
	}
	s.liveMu.Lock()
	g := s.live
	s.live = nil
	s.liveGen++
	s.liveMu.Unlock()
	if g == nil {
		return
	}
	defer s.groupChanged()
	if err := g.Close(); err != nil {
		s.logf("pairing: could not save the group on leaving it: %v", err)
	}
}

// openGroupLocked joins the stored group, if any. A relay that cannot be
// reached is no error here; the group keeps trying in the background.
func (s *Server) openGroupLocked() {
	// Members admitted under a group this instance left, or before the switch
	// went off, would otherwise stay on until they drop.
	s.servedRelay().Revoke()
	st := s.Pairing.Get()
	if st.Secret == nil {
		return
	}
	id, ok := s.identity()
	if !ok {
		return
	}
	mode, relayURL := group.RelayProject, ""
	switch st.Mode() {
	case pairing.ModeOwn:
		mode, relayURL = group.RelayOwn, strings.TrimSpace(st.RelayURL)
	case pairing.ModeOff:
		mode = group.RelayOff
	}
	gen := s.generation()
	if st.Fortress {
		s.openFortressLocked(st, id, mode, relayURL, gen)
		return
	}
	g, err := group.Open(group.Config{
		Domain:   pairing.Domain,
		Secret:   st.Secret,
		Identity: id,
		Self:     s.self(st),
		Relay:    mode,
		RelayURL: relayURL,
		LAN:      s.LAN,
		Store:    s.Pairing.GroupStore(),
		// Every ArrowLoop is an instance, its phone and desktop app included,
		// so a device of another kind holds the phrase and nothing else.
		Kinds: []member.Kind{member.KindInstance},
		Ports: s.groupPorts(),
		OnChange: func() {
			s.noteMemberSeen(gen)
			s.groupChanged()
		},
		OnRemoved: func() {
			s.groupMu.Lock()
			defer s.groupMu.Unlock()
			if s.generation() == gen {
				s.logf("pairing: an instance of the group took this one out, so it left the group")
				s.enterGroupLocked(nil)
			}
		},
	}, kitfortress.Moving(s.groupHandler(), movedKeeper{s}))
	if err != nil {
		s.logf("pairing: could not join the group: %v", err)
		return
	}
	if err := s.Pairing.MoveLegacy(g); err != nil {
		s.logf("pairing: could not take over the group from before: %v", err)
	}
	s.liveMu.Lock()
	s.live = g
	s.liveMu.Unlock()
	s.groupChanged()
}

// GroupChanged is the phase of an event on the stream that says the group
// changed: somebody came, went, waits or was approved, or the relay came or
// went. It names no job.
const GroupChanged = "group"

// WatchGroup returns a channel that receives whenever the group changes, and
// the function that ends the watch. A burst of changes may arrive as one.
func (s *Server) WatchGroup() (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	s.watchMu.Lock()
	if s.watchers == nil {
		s.watchers = map[chan struct{}]struct{}{}
	}
	s.watchers[ch] = struct{}{}
	s.watchMu.Unlock()
	return ch, func() {
		s.watchMu.Lock()
		delete(s.watchers, ch)
		s.watchMu.Unlock()
	}
}

func (s *Server) groupChanged() {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	for ch := range s.watchers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// self is what the other members see of this instance.
func (s *Server) self(st pairing.State) group.Self {
	return group.Self{Name: s.instanceName(st), Deployment: s.Deployment, DirectURL: s.DirectURL}
}

// defaultPort is where an ArrowLoop listens unless told otherwise.
const defaultPort = 8422

// groupPorts are where the instances of the group take calls, for an address
// the group learned rather than one announced.
func (s *Server) groupPorts() []int {
	if len(s.Ports) > 0 {
		return s.Ports
	}
	return []int{defaultPort}
}

// noteMemberSeen records when another instance first showed up in the group,
// for the Pairing tile, as soon as the group of generation gen sees one.
func (s *Server) noteMemberSeen(gen uint64) {
	st := s.Pairing.Get()
	if st.JoinedAt.IsZero() || !st.MemberSeenAt.IsZero() || s.generation() != gen {
		return
	}
	for _, m := range s.instances() {
		if m.Online() {
			now := time.Now()
			if err := s.Pairing.Update(func(stored *pairing.State) error { stored.MemberSeenAt = now; return nil }); err != nil {
				s.logf("pairing: could not record the first member of the group: %v", err)
			}
			return
		}
	}
}

// identity is the key this instance signs its calls to the group with, minted
// the first time it is needed. It belongs to one group: entering another
// mints a new one. ok is false outside a group.
func (s *Server) identity() (member.Identity, bool) {
	s.memberMu.Lock()
	defer s.memberMu.Unlock()
	st := s.Pairing.Get()
	if st.Secret == nil {
		return member.Identity{}, false
	}
	if len(st.Member) == ed25519.SeedSize {
		id, err := member.FromSeed(member.KindInstance, st.Member)
		return id, err == nil
	}
	id, err := member.NewIdentity(member.KindInstance)
	if err == nil {
		err = s.Pairing.Update(func(st *pairing.State) error { st.Member = id.Seed(); return nil })
	}
	if err != nil {
		s.logf("pairing: no member key, so the group refuses this instance's calls until one can be made: %v", err)
		return member.Identity{}, false
	}
	return id, true
}

// groupID is the id the group knows this instance by, "" outside a group.
func (s *Server) groupID() string {
	if id, ok := s.identity(); ok {
		return id.ID()
	}
	return ""
}

// instances is every other instance of the group this one knows.
func (s *Server) instances() []group.Member {
	if g := s.joined(); g != nil {
		return g.Members()
	}
	return nil
}

func (s *Server) relayConnected() bool {
	g := s.joined()
	return g != nil && g.RelayConnected()
}

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
	// Behind is every instance paired here before the fortress that had not
	// followed into it when the group from before closed.
	Behind []behindMember `json:"behind"`
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

// behindMember carries no address, since the owner finds the device by name.
type behindMember struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Deployment string `json:"deployment"`
}

type pendingMember struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Fingerprint string `json:"fingerprint"`
}

func (s *Server) readConnect(w http.ResponseWriter, r *http.Request) {
	s.noteAddress(r)
	writeJSON(w, http.StatusOK, s.connectInfo())
}

// noteAddress tells the group the address a signed-in browser reached this
// instance at, which is where the others on the network reach it too. From
// inside a container nothing else tells it. A phone and the desktop app take
// no calls from the network at all.
func (s *Server) noteAddress(r *http.Request) {
	if g := s.joined(); g != nil && s.canServe() {
		g.NoteAddress(r)
	}
}

func (s *Server) connectInfo() connectInfo {
	st := s.Pairing.Get()
	now := time.Now()
	info := connectInfo{
		Active:          st.Secret != nil,
		Connected:       s.relayConnected(),
		PasswordSet:     len(s.passwordHash()) > 0,
		RelayMode:       st.Mode(),
		RelayURL:        relayTarget(st),
		ProjectRelayURL: relay.DefaultURL,
		Name:            s.instanceName(st),
		Deployment:      s.Deployment,
		Members:         []groupMember{},
		Away:            []awayMember{},
		Pending:         []pendingMember{},
		Behind:          []behindMember{},
	}
	behind := map[string]bool{}
	if f := s.fortressNow(); f != nil {
		for _, m := range f.Behind() {
			behind[m.ID] = true
			info.Behind = append(info.Behind, behindMember{ID: m.ID, Name: m.Name, Deployment: m.Deployment})
		}
	}
	for _, m := range s.instances() {
		info.Awaiting = info.Awaiting || m.Awaiting
		if m.State == group.StatePending {
			info.Pending = append(info.Pending, pendingMember{ID: m.ID, Name: m.Name, Fingerprint: member.Fingerprint(m.Key)})
		}
		switch {
		case behind[m.ID]:
		case m.Online():
			info.Members = append(info.Members, groupMember{ID: m.ID, Name: m.Name, Deployment: m.Deployment, Address: m.Address, Approved: m.State == group.StateApproved})
		case m.State == group.StateApproved:
			info.Away = append(info.Away, awayMember{ID: m.ID, Name: m.Name, Deployment: m.Deployment, Address: m.Address, LastSeen: m.LastSeen.Unix()})
		}
	}
	sort.Slice(info.Pending, func(i, j int) bool { return info.Pending[i].ID < info.Pending[j].ID })
	if !st.JoinedAt.IsZero() {
		info.JoinedAgo = max(int64(now.Sub(st.JoinedAt).Seconds()), 0)
	}
	info.MemberSeen = !st.MemberSeenAt.IsZero()
	if id, ok := s.identity(); ok {
		info.Fingerprint = member.Fingerprint(id.Public())
	}
	return info
}

// instanceName is what the other instances see this one as: the name given on
// the Pairing tile, else the machine's. A container's own hostname is its id,
// so on Unraid the server's name comes from HOST_HOSTNAME, which Unraid sets
// on every container.
func (s *Server) instanceName(st pairing.State) string {
	if name := strings.TrimSpace(st.Name); name != "" {
		return name
	}
	if name := strings.TrimSpace(os.Getenv("HOST_HOSTNAME")); name != "" {
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
	if g := s.joined(); g != nil {
		g.SetSelf(s.self(s.Pairing.Get()))
	}
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
	secret, words, err := phrase.New()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if err := s.enterGroup(secret); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"phrase": words, "code": s.pairingCode(words), "info": s.connectInfo()})
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
	secret, err := phrase.Decode(words)
	if err != nil {
		// The reason and its details rather than a sentence, so the interface
		// can explain the mistyped word in the reader's language.
		var de *phrase.DecodeError
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
	words, err := phrase.Encode(secret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"phrase": words, "code": s.pairingCode(words)})
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
func (s *Server) pairingCode(words string) string {
	st := s.Pairing.Get()
	own := ""
	if st.Mode() == pairing.ModeOwn {
		own = st.RelayURL
	}
	return relay.PairingCode(words, own)
}

// enterGroup stores secret as this instance's group, or leaves the group with
// nil. Either way the group starts over with nobody seen in it and nobody
// approved, under a new member key, which the others pin as a new instance.
func (s *Server) enterGroup(secret []byte) error {
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	return s.enterGroupLocked(secret)
}

func (s *Server) enterGroupLocked(secret []byte) error {
	// Closed first, so the group cannot save its members over the fresh start.
	s.closeGroupLocked()
	joined := time.Time{}
	if secret != nil {
		joined = time.Now()
	}
	err := s.Pairing.Update(func(st *pairing.State) error {
		st.Secret, st.Member, st.Fortress = secret, nil, false
		st.JoinedAt, st.MemberSeenAt = joined, time.Time{}
		return nil
	})
	s.openGroupLocked()
	return err
}

// onlineInstances is the approved instances of the group that can be called
// now, but for except.
func (s *Server) onlineInstances(except string) []string {
	var out []string
	for _, m := range s.instances() {
		if m.ID != except && m.State == group.StateApproved && m.Online() {
			out = append(out, m.ID)
		}
	}
	return out
}

// removeMember takes another instance out of the group on every instance of
// it: its key is revoked, it hears it and leaves, and it comes back as a new
// instance waiting for approval when the phrase is entered there again.
func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	g := s.joined()
	switch {
	case id == s.groupID():
		writeError(w, http.StatusBadRequest, errors.New("to leave the group, use DELETE /api/connect"))
		return
	case g == nil:
		writeError(w, http.StatusBadRequest, errors.New("this instance is in no group"))
		return
	}
	tell := s.onlineInstances("")
	if err := g.Remove(id); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	go s.passOn(g, tell, http.MethodDelete, "/api/connect/members/"+url.PathEscape(id), nil)
	w.WriteHeader(http.StatusNoContent)
}

// memberDecision is what an approval carries on the routes instances without
// the kit pass decisions on: the key approved and the kind it signs as.
type memberDecision struct {
	Key  []byte `json:"key,omitempty"`
	Kind string `json:"kind,omitempty"`
}

func (s *Server) approveMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	g := s.joined()
	if g == nil {
		writeError(w, http.StatusNotFound, errors.New("this instance is in no group"))
		return
	}
	if !answerApproval(w, g.Approve(id)) {
		return
	}
	for _, m := range s.instances() {
		if m.ID == id {
			body, _ := json.Marshal(memberDecision{Key: m.Key, Kind: string(m.Kind)})
			go s.passOn(g, s.onlineInstances(id), http.MethodPost, "/api/connect/devices/"+url.PathEscape(id)+"/approve", body)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) refuseMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	g := s.joined()
	if g == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	tell := s.onlineInstances(id)
	if err := g.Remove(id); err != nil && !errors.Is(err, group.ErrNoSuchMember) {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	go s.passOn(g, tell, http.MethodPost, "/api/connect/devices/"+url.PathEscape(id)+"/refuse", []byte("{}"))
	w.WriteHeader(http.StatusNoContent)
}

// answerApproval answers a failed approval and reports whether there was
// none.
func answerApproval(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, group.ErrNoSuchMember):
		writeError(w, http.StatusNotFound, err)
	case errors.Is(err, group.ErrRemoved):
		writeError(w, http.StatusGone, err)
	default:
		writeError(w, http.StatusInternalServerError, err)
	}
	return false
}

// passOn hands a decision the owner made here to the instances in to, on the
// route ArrowLoop used before the kit. The group passes it on over its own
// route as well, but an instance that has not taken the update yet hears it
// only here; one that has answers it without acting twice. A 404 is such an
// instance that does not know the member yet and takes it from the group.
func (s *Server) passOn(g *group.Group, to []string, method, path string, body []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*relayTimeout)
	defer cancel()
	for _, id := range to {
		status, _, err := g.Call(ctx, id, method, path, body)
		if err != nil || (status >= 300 && status != http.StatusNotFound) {
			s.logf("pairing: could not pass %s %s on to %s: status %d, %v", method, path, id, status, err)
		}
	}
}

// relayView is what the relay routes answer.
type relayView struct {
	Mode            string `json:"mode"`
	RelayURL        string `json:"relayUrl"`
	ProjectRelayURL string `json:"projectRelayUrl"`
	Connected       bool   `json:"connected"`
	// Serve is whether this instance runs the relay of its group, and
	// ServeClients how many instances are on it at the moment, this one
	// included when it dials its own. CanServe is false where nobody else
	// reaches the instance: on a phone and in the desktop app.
	Serve        bool `json:"serve"`
	ServeClients int  `json:"serveClients"`
	CanServe     bool `json:"canServe"`
}

func (s *Server) relayView() relayView {
	st := s.Pairing.Get()
	v := relayView{
		Mode: st.Mode(), RelayURL: st.RelayURL, ProjectRelayURL: relay.DefaultURL, Connected: s.relayConnected(),
		Serve: st.RelayServe, CanServe: s.canServe(),
	}
	// Sockets admitted before the switch went off are dropped when the group
	// opens again, so the count only means something while it is on.
	if s.serving(st) {
		v.ServeClients = s.servedRelay().Len()
	}
	return v
}

func (s *Server) readRelay(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.relayView())
}

func (s *Server) writeRelay(w http.ResponseWriter, r *http.Request) {
	// Pointers, so a save from one control does not carry the other back.
	var req struct {
		Mode     *string `json:"mode"`
		RelayURL *string `json:"relayUrl"`
		Serve    *bool   `json:"serve"`
	}
	if !readBody(w, r, &req) {
		return
	}
	if req.Mode != nil && !pairing.ValidMode(*req.Mode) {
		writeError(w, http.StatusBadRequest, errors.New("the relay mode is project, own or off"))
		return
	}
	if req.Serve != nil && *req.Serve && !s.canServe() {
		writeError(w, http.StatusBadRequest, errors.New("only an instance the others can reach serves a relay, and a phone or the desktop app is not one"))
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
		if req.Serve != nil {
			st.RelayServe = *req.Serve
		}
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.applyGroup()
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
	return relay.DefaultURL
}

// servedRelayPath is where an instance that serves the relay of its group
// answers, on the address it already has. The relay client puts it behind an
// address that has no path, so members may enter the bare address.
const servedRelayPath = "/relay/connect"

// canServe reports whether the others can reach this instance at all. The
// phone's engine answers only the app that started it, and the desktop app's
// only its own window.
func (s *Server) canServe() bool {
	return s.Deployment != "phone" && s.Deployment != "desktop"
}

// serving reports whether this instance runs the relay of its group: the
// switch is on and there is a group whose key could get in.
func (s *Server) serving(st pairing.State) bool {
	return st.RelayServe && st.Secret != nil && s.canServe()
}

// servedRelay is the relay this instance serves. It lives as long as the
// process and reads the switch and the key on every connection, so saving
// an unrelated setting does not drop the members on it.
func (s *Server) servedRelay() *relay.Server {
	s.servedOnce.Do(func() {
		srv := relay.New()
		srv.Admit = func(key string) bool {
			st := s.Pairing.Get()
			// Constant time, because the caller controls the guess.
			return s.serving(st) && hmac.Equal([]byte(key), []byte(pairing.Domain.GroupKey(st.Secret)))
		}
		srv.TrustedProxies = s.trustedProxies
		s.served = srv
	})
	return s.served
}

// serveRelay is the relay socket while this instance serves one. With the
// switch off it answers like a version without the feature.
func (s *Server) serveRelay(w http.ResponseWriter, r *http.Request) {
	if !s.serving(s.Pairing.Get()) {
		writeError(w, http.StatusNotFound, fmt.Errorf("no such address: %s", r.URL.Path))
		return
	}
	s.servedRelay().ServeHTTP(w, r)
}

// serveDirect takes the calls other instances on this network make here.
// Outside a group it answers like a version without the feature.
func (s *Server) serveDirect(w http.ResponseWriter, r *http.Request) {
	if f := s.fortressNow(); f != nil {
		s.liveMu.Lock()
		movers := s.movers
		s.liveMu.Unlock()
		f.DirectHandler(movers).ServeHTTP(w, r)
		return
	}
	g := s.joined()
	if g == nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("no such address: %s", r.URL.Path))
		return
	}
	g.DirectHandler().ServeHTTP(w, r)
}

// groupRoute is one call another member of the group may make here.
type groupRoute struct {
	pattern string
	handle  func(s *Server, w http.ResponseWriter, r *http.Request)
}

// legacyHelloPath is where instances without the kit greet the others.
const legacyHelloPath = "/api/group/hello"

// groupRoutes is everything another member of the group may ask. Settings,
// the targets themselves, adding or removing a job, the trash and the phrase
// stay with the owner, and a route the main router gains stays out of reach
// until it is listed here. The group answers its own routes before these.
func groupRoutes() []groupRoute {
	return []groupRoute{
		{"GET " + legacyHelloPath, (*Server).groupHello},
		{"GET /api/jobs", (*Server).listJobs},
		{"POST /api/jobs/{name}/run", (*Server).groupRunJob},
		{"POST /api/jobs/{name}/stop", (*Server).groupStopJob},
		{"GET /api/jobs/{name}/config", (*Server).groupReadJob},
		{"PUT /api/jobs/{name}/config", (*Server).groupSaveJob},
		{"GET /api/places", (*Server).groupPlaces},
		{"GET /api/browse", (*Server).groupBrowse},
		{"DELETE /api/connect/members/{id}", (*Server).groupRemoveMember},
		{"POST /api/connect/devices/{id}/approve", (*Server).groupApproveMember},
		{"POST /api/connect/devices/{id}/refuse", (*Server).groupRefuseMember},
		{"POST " + changedPhrasePath, (*Server).takeChangedPhrase},
	}
}

// groupHandler serves groupRoutes and answers 404 to everything else.
func (s *Server) groupHandler() http.Handler {
	s.groupOnce.Do(func() {
		mux := http.NewServeMux()
		for _, route := range groupRoutes() {
			handle := route.handle
			mux.HandleFunc(route.pattern, func(w http.ResponseWriter, r *http.Request) { handle(s, w, r) })
		}
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, fmt.Errorf("no such address for the group: %s %s", r.Method, r.URL.Path))
		})
		s.group = mux
	})
	return s.group
}

func (s *Server) groupHello(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"name": s.instanceName(s.Pairing.Get())})
}

// groupRunJob starts a whole run, as Run now does. A selection or a choice in
// a conflict is made at the instance itself, where the files are.
func (s *Server) groupRunJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, ok := s.Runner.Config().Find(name); !ok {
		writeError(w, http.StatusNotFound, fmt.Errorf("no job called %q", name))
		return
	}
	s.logf("pairing: %s started the job %q here", s.callerName(r), name)
	go func() {
		_, _ = s.Runner.RunChosen(context.Background(), name, nil, nil, nil)
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"job": name, "status": "started"})
}

// groupStopJob cancels a run, as Cancel the run does here.
func (s *Server) groupStopJob(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if s.Runner.Cancel(name) {
		s.logf("pairing: %s stopped the run of the job %q here", s.callerName(r), name)
		writeJSON(w, http.StatusOK, map[string]any{"stopped": true})
		return
	}
	s.stopJob(w, r)
}

// fromApprovedInstance reports whether a call from the group came from an
// instance. The group serves only members approved here, and only an
// instance decides who else is in it.
func fromApprovedInstance(r *http.Request) bool {
	c, ok := group.CallerOf(r.Context())
	return ok && c.Kind == member.KindInstance
}

func refuseDecision(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, map[string]string{
		"code":  "decisionNotFromInstance",
		"error": "only an approved instance of the group passes an approval, a refusal or a removal on",
	})
}

// groupRemoveMember takes a removal an instance without the kit passed on.
func (s *Server) groupRemoveMember(w http.ResponseWriter, r *http.Request) {
	if !fromApprovedInstance(r) {
		refuseDecision(w)
		return
	}
	id := r.PathValue("id")
	if id == s.groupID() {
		// Answered before the relay socket closes under this call, and left
		// on a goroutine of its own, since leaving waits for this very call.
		w.WriteHeader(http.StatusNoContent)
		gen := s.generation()
		go func() {
			s.groupMu.Lock()
			defer s.groupMu.Unlock()
			if s.generation() != gen {
				return
			}
			if err := s.enterGroupLocked(nil); err != nil {
				s.logf("pairing: did not leave the group after an instance of it took this one out: %v", err)
			}
		}()
		return
	}
	s.importDecision(w, group.Roster{Removed: map[string]time.Time{id: time.Now()}})
}

// importDecision takes a decision an instance without the kit passed on as
// the group takes one from its own route, without passing it on again.
func (s *Server) importDecision(w http.ResponseWriter, r group.Roster) {
	if g := s.joined(); g != nil {
		if err := g.Import(r); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// groupApproveMember takes an approval an instance without the kit passed on,
// with the key of the instance approved.
func (s *Server) groupApproveMember(w http.ResponseWriter, r *http.Request) {
	if !fromApprovedInstance(r) {
		refuseDecision(w)
		return
	}
	var passed memberDecision
	if !readBody(w, r, &passed) {
		return
	}
	id := r.PathValue("id")
	if member.Kind(passed.Kind) != member.KindInstance || member.ID(member.KindInstance, passed.Key) != id {
		writeError(w, http.StatusBadRequest, errors.New("an approval passed on carries the key and the kind of the instance approved"))
		return
	}
	for _, m := range s.instances() {
		if m.ID == id && m.Key != nil && !bytes.Equal(m.Key, passed.Key) {
			writeError(w, http.StatusConflict, errors.New("this instance pinned another key for that member"))
			return
		}
	}
	s.importDecision(w, group.Roster{Members: []group.Member{{ID: id, Kind: member.KindInstance, Key: passed.Key, State: group.StateApproved}}})
}

// groupRefuseMember takes a refusal an instance without the kit passed on.
func (s *Server) groupRefuseMember(w http.ResponseWriter, r *http.Request) {
	if !fromApprovedInstance(r) {
		refuseDecision(w)
		return
	}
	s.importDecision(w, group.Roster{Removed: map[string]time.Time{r.PathValue("id"): time.Now()}})
}

// instanceView is one other instance as the overview shows it.
type instanceView struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Deployment string `json:"deployment"`
	Address    string `json:"address,omitempty"`
	// State is "ok" with Jobs, "approve" while it waits for approval here,
	// "waiting" while this instance waits for approval there, "away" when
	// neither the network nor the relay reaches it, and "error" when it did
	// not answer.
	State string            `json:"state"`
	Jobs  []json.RawMessage `json:"jobs,omitempty"`
	// LastSeen is Unix seconds, for an instance that is away.
	LastSeen int64  `json:"lastSeen,omitempty"`
	Error    string `json:"error,omitempty"`
}

// listInstances asks every other instance of the group for its jobs, side by
// side, so one that is slow does not hold up the others.
func (s *Server) listInstances(w http.ResponseWriter, r *http.Request) {
	s.noteAddress(r)
	g := s.joined()
	var online, away []instanceView
	var asks []int
	for _, m := range s.instances() {
		view := instanceView{ID: m.ID, Name: m.Name, Deployment: m.Deployment, Address: m.Address}
		switch {
		case m.Online() && m.State == group.StatePending:
			view.State = "approve"
		case m.Online():
			asks = append(asks, len(online))
		case m.State == group.StateApproved:
			view.State, view.LastSeen = "away", m.LastSeen.Unix()
			away = append(away, view)
			continue
		default:
			continue
		}
		online = append(online, view)
	}
	var wg sync.WaitGroup
	for _, i := range asks {
		wg.Go(func() {
			ctx, cancel := context.WithTimeout(r.Context(), relayTimeout)
			defer cancel()
			online[i].State, online[i].Jobs, online[i].Error = memberJobs(ctx, g, online[i].ID)
		})
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, append(append([]instanceView{}, online...), away...))
}

// memberJobs is one member's job list, or why there is none.
func memberJobs(ctx context.Context, g *group.Group, id string) (string, []json.RawMessage, string) {
	status, body, err := g.Call(ctx, id, http.MethodGet, "/api/jobs", nil)
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
	s.toInstance(w, r, "/api/jobs/"+url.PathEscape(r.PathValue("name"))+"/"+action)
}
