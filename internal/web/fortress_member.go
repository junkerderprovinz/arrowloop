package web

import (
	"bytes"
	"cmp"
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	kitfortress "github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/lan"
	"github.com/junkerderprovinz/parleyport/kit/member"
	"github.com/junkerderprovinz/parleyport/kit/phrase"

	"github.com/junkerderprovinz/arrowloop/internal/pairing"
)

var (
	errInFortress = errors.New("this instance is in a fortress already")
	errNoFortress = errors.New("this instance is in no fortress")
	errNoMember   = errors.New("no other member of the fortress has that id")
	// errClosedUntilNewPhrase is a join the members turned away: one of them
	// was removed, and the fortress takes no new app until its phrase changes.
	errClosedUntilNewPhrase = errors.New("the fortress takes no new app until its phrase changes")
)

// moveWait is how often the instances the pairing had before the fortress
// are handed its phrase again, until each of them has it.
var moveWait = time.Minute

// previousKept is how long the fortress is given its secret before a change
// of phrase. The kit answers on that phrase meanwhile, so that the members
// that hold only keys, such as the Unraid plugins, fetch the new ones.
const previousKept = 30 * 24 * time.Hour

// fortressNow is the fortress this instance is in, nil outside one.
func (s *Server) fortressNow() *kitfortress.Fortress {
	s.liveMu.Lock()
	defer s.liveMu.Unlock()
	return s.fort
}

// openFortressLocked opens the fortress st names, and the pairing with it,
// with groupMu held.
func (s *Server) openFortressLocked(st pairing.State, id member.Identity, mode group.RelayMode, relayURL string, gen uint64) {
	if st.FortressPrevious != nil && time.Since(st.FortressChanged) >= previousKept {
		if err := s.Pairing.ForgetFortressPrevious(); err != nil {
			s.logf("fortress: could not forget the phrase before the last change: %v", err)
			st.FortressPrevious = nil
		} else {
			st = s.Pairing.Get()
		}
	}
	network := s.fortressLAN()
	cfg := s.fortressConfig(st, id, mode, relayURL, network)
	cfg.Previous = st.FortressPrevious
	cfg.Keeper = fortressKeeper{s}
	cfg.Store = s.Pairing.FortressStore()
	cfg.Pairing = &kitfortress.Pairing{
		Group: group.Config{
			Previous: st.PairingPrevious,
			LAN:      s.LAN,
			Store:    s.Pairing.GroupStore(),
			Kinds:    []member.Kind{member.KindInstance},
			Ports:    s.groupPorts(),
			OnChange: func() {
				s.noteMemberSeen(gen)
				s.groupChanged()
			},
		},
		Serve: s.groupHandler(),
	}
	cfg.OnRemoved = func() { s.removedFrom(gen) }
	f, err := kitfortress.Open(cfg)
	if err != nil {
		if network != nil {
			_ = network.Close()
		}
		s.logf("fortress: could not join the fortress: %v", err)
		return
	}
	s.liveMu.Lock()
	s.fort, s.fortLAN, s.live = f, network, f.Pairing()
	s.liveMu.Unlock()
	if st.FortressPrevious != nil {
		s.forget = time.AfterFunc(time.Until(st.FortressChanged.Add(previousKept)), s.applyGroup)
	}
	if st.MoveFrom != nil {
		ctx, cancel := context.WithCancel(context.Background())
		s.moveStop = cancel
		s.moving.Go(func() { s.move(ctx, st, id, mode, relayURL) })
	}
	s.groupChanged()
}

// fortressLAN is the service that announces this instance to the fortress on
// this network, started, or nil without one.
func (s *Server) fortressLAN() *lan.Service {
	if s.LAN == nil {
		return nil
	}
	network := lan.New(lan.Config{Group: kitfortress.Multicast, Ports: s.groupPorts()})
	network.Start()
	return network
}

// fortressConfig is what this instance shows the fortress of st.Secret and
// does for its members, the same while a join is still being tried.
func (s *Server) fortressConfig(st pairing.State, id member.Identity, mode group.RelayMode, relayURL string, network *lan.Service) kitfortress.Config {
	return kitfortress.Config{
		App: kitfortress.App{ID: string(pairing.Domain), Name: "ArrowLoop", Version: memberVersion(), Icon: appIcon},
		// Unraid names its server to every container, and the apps of a
		// fortress on one server find each other by it.
		Host:     strings.TrimSpace(os.Getenv("HOST_HOSTNAME")),
		Secret:   st.Secret,
		Identity: id,
		Self:     s.self(st),
		Relay:    mode,
		RelayURL: relayURL,
		LAN:      network,
		Status:   fortressSource{s},
		Actions:  s.FortressActions(),
		Uses:     []string{kitfortress.OpenAction},
		UI:       s.fortressUI(),
		Export:   s.FortressExport,
		Import:   s.FortressImport,
	}
}

// closeFortressLocked leaves the fortress, the pairing and the move, with
// groupMu held. It reports whether this instance was in one.
func (s *Server) closeFortressLocked() bool {
	if s.forget != nil {
		s.forget.Stop()
		s.forget = nil
	}
	if s.moveStop != nil {
		s.moveStop()
		s.moving.Wait()
		s.moveStop = nil
	}
	s.liveMu.Lock()
	f, network := s.fort, s.fortLAN
	s.fort, s.fortLAN = nil, nil
	if f != nil {
		s.live = nil
		s.liveGen++
	}
	s.liveMu.Unlock()
	if f == nil {
		return false
	}
	if err := f.Close(); err != nil {
		s.logf("fortress: could not save the fortress on leaving it: %v", err)
	}
	if network != nil {
		_ = network.Close()
	}
	s.groupChanged()
	return true
}

// removedFrom leaves the fortress once another member took this instance
// out. The kit calls it on a goroutine closing waits for, so the work runs on
// one of its own.
func (s *Server) removedFrom(gen uint64) {
	go func() {
		s.groupMu.Lock()
		defer s.groupMu.Unlock()
		if s.generation() != gen {
			return
		}
		s.logf("fortress: another member took this instance out, so it left the fortress")
		_ = s.enterGroupLocked(nil)
		if err := s.Pairing.Update(func(st *pairing.State) error { st.RemovedHere = true; return nil }); err != nil {
			s.logf("fortress: could not note that another member took this instance out: %v", err)
		}
		s.groupChanged()
	}()
}

// fortressKeeper keeps a new fortress phrase another member hands over, and
// opens the fortress again under it unless this instance changes the phrase
// itself.
type fortressKeeper struct{ s *Server }

func (k fortressKeeper) Keep(secret []byte) error {
	if err := k.s.Pairing.ChangeFortressSecret(secret); err != nil {
		return err
	}
	k.s.liveMu.Lock()
	changing := k.s.changing
	k.s.liveMu.Unlock()
	if !changing {
		go k.s.applyGroup()
	}
	return nil
}

// movedKeeper takes the fortress phrase an instance of the pairing hands over
// on joining the fortress, so that this one follows it there.
type movedKeeper struct{ s *Server }

func (k movedKeeper) Keep(secret []byte) error {
	if err := k.s.Pairing.EnterFortress(secret); err != nil {
		return err
	}
	k.s.logf("fortress: another instance of the group joined a fortress, and this one follows it")
	go k.s.applyGroup()
	return nil
}

// move hands the fortress phrase to the instances the pairing had under the
// app's own phrase that were away when this one joined, until each is in the
// pairing in the fortress or the kit closes the group from before after 30
// days. An instance that took the phrase and has not arrived when it changes
// is handed the new one the same way.
func (s *Server) move(ctx context.Context, st pairing.State, id member.Identity, mode group.RelayMode, relayURL string) {
	old, err := group.Open(group.Config{
		Domain: pairing.Domain, Secret: st.MoveFrom, Identity: id, Self: s.self(st),
		Relay: mode, RelayURL: relayURL, Store: s.Pairing.MoveStore(),
		Kinds: []member.Kind{member.KindInstance},
	}, s.moversHandler())
	if err != nil {
		s.logf("fortress: could not reach the instances of the group from before: %v", err)
		return
	}
	s.liveMu.Lock()
	s.movers = old
	s.liveMu.Unlock()
	defer func() {
		s.liveMu.Lock()
		s.movers = nil
		s.liveMu.Unlock()
		old.Close()
	}()
	tick := time.NewTicker(moveWait)
	defer tick.Stop()
	for {
		s.forgetTakenOut(old)
		kitfortress.Move(ctx, old, st.Secret)
		if f := s.fortressNow(); f != nil {
			if f.Settle(old) {
				if behind := len(f.Behind()); behind > 0 {
					s.logf("fortress: the group from before closed with %d instances that never followed", behind)
				}
				if err := s.Pairing.MoveDone(); err != nil {
					s.logf("fortress: could not note that the move into the fortress ended: %v", err)
				}
				s.groupChanged()
				return
			}
			s.passChange(ctx, old, online(f.Left(old), nil), st)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// forgetTakenOut drops from the group from before every instance the owner
// took out of the pairing since, so that it is never handed the fortress
// phrase.
func (s *Server) forgetTakenOut(old *group.Group) {
	g := s.joined()
	if g == nil {
		return
	}
	r := g.Roster()
	if err := old.Import(group.Roster{Removed: r.Removed, Revoked: r.Revoked}); err != nil {
		s.logf("fortress: could not note who was taken out of the group from before: %v", err)
	}
}

// changedPhrasePath is where an instance of the pairing takes the phrase the
// fortress changed to when the fortress did not reach it, such as one that
// took the phrase moments before and is not there yet. It answers in the
// pairing and, while its instances move, under the app's own phrase.
const changedPhrasePath = "/api/fortress/changed-phrase"

// changedPhrase carries the phrase the fortress changed from as well, which
// shows that the sender held the one it replaces, so that no sibling can turn
// an instance back to an older phrase or into another fortress.
type changedPhrase struct {
	From   []byte `json:"from"`
	Secret []byte `json:"secret"`
}

// passChange hands st's fortress phrase to those of ids that g reaches now,
// where it replaces st.FortressPrevious, and returns the ids that took it.
func (s *Server) passChange(ctx context.Context, g *group.Group, ids []string, st pairing.State) []string {
	if st.FortressPrevious == nil {
		return nil
	}
	body, err := json.Marshal(changedPhrase{From: st.FortressPrevious, Secret: st.Secret})
	if err != nil {
		return nil
	}
	var took []string
	for _, id := range ids {
		ctx, cancel := context.WithTimeout(ctx, relayTimeout)
		status, _, err := g.Call(ctx, id, http.MethodPost, changedPhrasePath, body)
		cancel()
		if err == nil && status == http.StatusNoContent {
			took = append(took, id)
		}
	}
	return took
}

// online lists the ids of the instances in ms that can be called now, but
// for those in except.
func online(ms []group.Member, except []string) []string {
	var ids []string
	for _, m := range ms {
		if m.Kind == member.KindInstance && m.State == group.StateApproved && m.Online() && !slices.Contains(except, m.ID) {
			ids = append(ids, m.ID)
		}
	}
	return ids
}

// moversHandler answers the instances of the pairing under the app's own
// phrase while they move into the fortress.
func (s *Server) moversHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != changedPhrasePath {
			writeError(w, http.StatusNotFound, fmt.Errorf("no such address for the group: %s %s", r.Method, r.URL.Path))
			return
		}
		s.takeChangedPhrase(w, r)
	})
}

func (s *Server) takeChangedPhrase(w http.ResponseWriter, r *http.Request) {
	if c, ok := group.CallerOf(r.Context()); !ok || c.Kind != member.KindInstance {
		writeError(w, http.StatusForbidden, errors.New("only an instance of the group hands on a phrase"))
		return
	}
	var req changedPhrase
	if !readBody(w, r, &req) {
		return
	}
	if len(req.Secret) != phrase.SecretLen {
		writeError(w, http.StatusBadRequest, errors.New("that is no phrase"))
		return
	}
	st := s.Pairing.Get()
	if !st.Fortress || !hmac.Equal(req.From, st.Secret) {
		writeError(w, http.StatusConflict, errors.New("this instance holds another phrase than the one that changed"))
		return
	}
	if err := (fortressKeeper{s}).Keep(req.Secret); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.logf("fortress: the fortress phrase changed where the fortress did not reach this instance, and it takes the new one")
	w.WriteHeader(http.StatusNoContent)
}

// joinFortress joins the fortress of secret, unless its members turn this
// instance away until the phrase changes. The instances paired with this one
// under the app's own phrase are handed the fortress phrase and follow, and
// the pairing moves with them, approvals kept.
func (s *Server) joinFortress(ctx context.Context, secret []byte) error {
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	st := s.Pairing.Get()
	if st.Fortress {
		return s.followPhraseLocked(secret)
	}
	// The members know this instance by the key it tries the join with, so
	// one outside a group keeps the key it made for that.
	id, ok := s.identity()
	if !ok {
		var err error
		if id, err = member.NewIdentity(member.KindInstance); err != nil {
			return err
		}
	}
	taken, err := s.takenIn(st, secret, id)
	if err != nil {
		return err
	}
	if !taken {
		s.logf("fortress: the members turned the join away until the phrase changes, because one of them was removed")
		return errClosedUntilNewPhrase
	}
	if old := s.joined(); old != nil {
		ctx, cancel := context.WithTimeout(ctx, relayTimeout)
		took := kitfortress.Move(ctx, old, secret)
		cancel()
		s.logf("fortress: joined a fortress, and %d instances of the group follow", len(took))
	}
	s.closeGroupLocked()
	err = s.Pairing.EnterFortress(secret)
	if err == nil && st.Secret == nil {
		now := time.Now()
		err = s.Pairing.Update(func(stored *pairing.State) error { stored.JoinedAt, stored.Member = now, id.Seed(); return nil })
	}
	s.openGroupLocked()
	return err
}

// followPhraseLocked takes the new words of the fortress this instance is
// in, with groupMu held, once a member said the phrase changed and nobody in
// reach hands it over. The members know the member key, so it comes back as
// the member it was.
func (s *Server) followPhraseLocked(secret []byte) error {
	if f := s.fortressNow(); f == nil || !f.PhraseChanged() {
		return errInFortress
	}
	s.closeGroupLocked()
	err := s.Pairing.ChangeFortressSecret(secret)
	s.openGroupLocked()
	return err
}

// joinWait bounds how long a join waits for the members to take this
// instance in or turn it away, and joinSettle is how long the relay has to
// list them once it connected, as the kit's own command waits.
var (
	joinWait   = 5 * time.Second
	joinSettle = 1500 * time.Millisecond
)

// takenIn opens the fortress of secret under id until its members answer, and
// reports whether they take this instance in, which after a removal they do
// not until the phrase changes. The trial keeps nothing, so a refusal leaves
// the pairing as it was and hands no instance the phrase.
func (s *Server) takenIn(st pairing.State, secret []byte, id member.Identity) (bool, error) {
	trial := st
	trial.Secret, trial.Fortress = secret, true
	mode, relayURL := relayOf(st)
	network := s.fortressLAN()
	if network != nil {
		defer func() { _ = network.Close() }()
	}
	cfg := s.fortressConfig(trial, id, mode, relayURL, network)
	cfg.Store = &memoryStore{}
	f, err := kitfortress.Open(cfg)
	if err != nil {
		return false, err
	}
	defer f.Close()
	return !turnedAway(f, relayTarget(st) != "", network != nil), nil
}

// turnedAway waits until a member of f turns this instance away or takes it
// in, until the relay lists nobody to do either, or until joinWait is over.
// Members on this network may announce themselves any moment, so only a
// fortress reached through the relay alone can tell that nobody is there.
func turnedAway(f *kitfortress.Fortress, relayed, onLAN bool) bool {
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	deadline := time.After(joinWait)
	var connected time.Time
	for {
		if f.ShutOut() {
			return true
		}
		members := f.Members()
		if slices.ContainsFunc(members, func(m kitfortress.Member) bool { return m.State == group.StateApproved }) {
			return false
		}
		now := time.Now()
		if relayed && connected.IsZero() && f.RelayConnected() {
			connected = now
		}
		settled := !relayed || !connected.IsZero() && now.Sub(connected) >= joinSettle
		if !onLAN && settled && len(members) == 0 {
			return false
		}
		select {
		case <-deadline:
			return false
		case <-tick.C:
		}
	}
}

// memoryStore keeps what the kit saves for a fortress that is only tried.
type memoryStore struct {
	mu  sync.Mutex
	raw []byte
}

func (m *memoryStore) Load() ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return bytes.Clone(m.raw), nil
}

func (m *memoryStore) Save(raw []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.raw = bytes.Clone(raw)
	return nil
}

// changeFortressPhrase gives the fortress a new phrase and returns its words
// and the members that still hold the old one.
func (s *Server) changeFortressPhrase(ctx context.Context) (string, []leftMember, error) {
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	f := s.fortressNow()
	if f == nil {
		return "", nil, errNoFortress
	}
	s.liveMu.Lock()
	s.changing = true
	s.liveMu.Unlock()
	took, err := f.ChangePhrase(ctx)
	s.liveMu.Lock()
	s.changing = false
	s.liveMu.Unlock()
	if err != nil {
		return "", nil, err
	}
	// The fortress reaches only the members it heard of, so the instances of
	// the pairing it missed are handed the phrase in the pairing, and those
	// still moving in under the app's own phrase, which may have taken the
	// first moments ago.
	st := s.Pairing.Get()
	paired := f.Pairing()
	took = append(took, s.passChange(ctx, paired, online(paired.Members(), took), st)...)
	s.liveMu.Lock()
	old := s.movers
	s.liveMu.Unlock()
	var moving []group.Member
	if old != nil {
		moving = f.Left(old)
		took = append(took, s.passChange(ctx, old, online(moving, took), st)...)
	}

	left := []leftMember{}
	noted := map[string]bool{}
	note := func(id, app, device string) {
		if !slices.Contains(took, id) && !noted[id] {
			noted[id] = true
			left = append(left, leftMember{App: app, Device: device})
		}
	}
	for _, m := range f.Members() {
		if m.Kind == member.KindInstance {
			note(m.ID, cmp.Or(m.App.Name, m.App.ID), m.Device)
		}
	}
	// Every instance the pairing approved counts, whether or not the move has
	// its group open: one moving in may hold the phrase from before, and its
	// answer can get lost as it leaves the pairing. Those left behind are
	// listed apart.
	behind := map[string]bool{}
	for _, m := range f.Behind() {
		behind[m.ID] = true
	}
	for _, m := range paired.Members() {
		if m.Kind == member.KindInstance && m.State == group.StateApproved && !behind[m.ID] {
			note(m.ID, "ArrowLoop", m.Name)
		}
	}
	slices.SortFunc(left, func(x, y leftMember) int {
		return cmp.Or(cmp.Compare(x.Device, y.Device), cmp.Compare(x.App, y.App))
	})
	s.closeGroupLocked()
	s.openGroupLocked()
	words, err := phrase.Encode(s.Pairing.Get().Secret)
	return words, left, err
}

// leftMember is a member the phrase change did not reach. App is empty for
// one that never said which app it runs.
type leftMember struct {
	App    string `json:"app"`
	Device string `json:"device"`
}

// removeFortressMember takes another member out of the fortress, here and at
// every member in reach, and keeps its name until the phrase changes, since
// until then the fortress takes no new app. This instance is no other member,
// so it leaves instead.
func (s *Server) removeFortressMember(id string) error {
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	f := s.fortressNow()
	if f == nil {
		return errNoFortress
	}
	for _, m := range f.Members() {
		if m.ID != id {
			continue
		}
		if err := f.Remove(id); err != nil {
			return err
		}
		gone := pairing.Removed{App: m.App.ID, Name: cmp.Or(m.App.Name, m.App.ID), Device: m.Device}
		err := s.Pairing.Update(func(st *pairing.State) error { st.Removed = append(st.Removed, gone); return nil })
		s.groupChanged()
		return err
	}
	return errNoMember
}

// fortressView is what GET /api/fortress answers with, in the shape every app
// of the fortress uses. It never carries the phrase.
type fortressView struct {
	Joined bool `json:"joined"`
	// Phrase says whether this instance keeps the phrase to show and change
	// it, which it always does in a fortress.
	Phrase        bool                     `json:"phrase"`
	Device        string                   `json:"device"`
	DefaultDevice string                   `json:"defaultDevice"`
	PasswordSet   bool                     `json:"passwordSet"`
	Members       []fortressMemberView     `json:"members"`
	Permissions   []fortressPermissionView `json:"permissions"`
	// Removed are the members taken out here since the phrase last changed,
	// and RemovedHere says another member took this instance out.
	Removed     []pairing.Removed `json:"removed"`
	RemovedHere bool              `json:"removedHere"`
	// PhraseChanged says a member told this instance that the fortress has a
	// new phrase, which nobody in reach hands over, so the owner enters it.
	PhraseChanged bool `json:"phraseChanged"`
}

// fortressMemberView is another instance of the fortress. App and Name are
// empty for one known by its device alone, which never said which app it
// runs.
type fortressMemberView struct {
	ID         string `json:"id"`
	App        string `json:"app"`
	Name       string `json:"name"`
	Version    string `json:"version"`
	Device     string `json:"device"`
	Deployment string `json:"deployment"`
	Kind       string `json:"kind"`
	Online     bool   `json:"online"`
	// Relay means it is reached through the relay alone.
	Relay    bool  `json:"relay"`
	LastSeen int64 `json:"lastSeen,omitempty"`
	// Host is the server it says it runs on, and Pages whether its pages
	// open from here through the fortress.
	Host  string `json:"host,omitempty"`
	Pages bool   `json:"pages"`
}

type fortressPermissionView struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Action string `json:"action"`
	On     bool   `json:"on"`
}

func (s *Server) fortressView() fortressView {
	st := s.Pairing.Get()
	v := fortressView{
		Joined: st.Fortress, Phrase: st.Fortress,
		Device: st.Name, DefaultDevice: s.instanceName(pairing.State{}),
		PasswordSet: len(s.passwordHash()) > 0,
		Members:     []fortressMemberView{}, Permissions: []fortressPermissionView{},
		Removed: append([]pairing.Removed{}, st.Removed...), RemovedHere: st.RemovedHere,
	}
	f := s.fortressNow()
	if f == nil {
		return v
	}
	v.PhraseChanged = f.PhraseChanged()
	v.Members = memberViews(f.Members())
	own := string(pairing.Domain)
	for _, p := range f.Permissions() {
		if p.From == own || p.To == own {
			v.Permissions = append(v.Permissions, fortressPermissionView{From: p.From, To: p.To, Action: p.Action, On: p.On})
		}
	}
	return v
}

func memberViews(members []kitfortress.Member) []fortressMemberView {
	out := []fortressMemberView{}
	for _, m := range members {
		if m.State != group.StateApproved {
			continue
		}
		mv := fortressMemberView{
			ID: m.ID, Device: m.Device, Deployment: m.Deployment, Kind: string(m.Kind),
			Online: m.Online(), Relay: m.Relay && !m.Direct, Host: m.Host,
		}
		if m.App.ID != "" {
			mv.App, mv.Name, mv.Version = m.App.ID, m.App.Name, m.App.Version
			mv.Pages = slices.Contains(m.Actions, kitfortress.OpenAction)
		}
		if !m.LastSeen.IsZero() {
			mv.LastSeen = m.LastSeen.Unix()
		}
		out = append(out, mv)
	}
	return out
}

func (s *Server) fortressRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/fortress", s.readFortress)
	mux.HandleFunc("POST /api/fortress/join", s.joinFortressRoute)
	mux.HandleFunc("POST /api/fortress/phrase/show", s.showFortressPhrase)
	mux.HandleFunc("POST /api/fortress/phrase", s.changeFortressRoute)
	mux.HandleFunc("PUT /api/fortress/device", s.nameFortressDevice)
	mux.HandleFunc("PUT /api/fortress/permissions", s.switchFortressPermission)
	mux.HandleFunc("DELETE /api/fortress/members/{id}", s.removeFortressRoute)
	mux.HandleFunc("DELETE /api/fortress", s.leaveFortress)
	mux.HandleFunc("POST /api/fortress/open/{id}", s.openMember)
	mux.HandleFunc("GET /api/fortress/members/{id}/status", s.memberStatus)
}

// writeFortressError answers with the code the page words a refusal by.
func writeFortressError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errInFortress):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error(), "code": "inFortress"})
	case errors.Is(err, errNoFortress):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error(), "code": "noFortress"})
	case errors.Is(err, errNoMember):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error(), "code": "noMember"})
	case errors.Is(err, errClosedUntilNewPhrase):
		// GlimStone words this refusal in the reader's language by its code.
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "code": group.ClosedUntilNewPhrase})
	default:
		writeError(w, http.StatusInternalServerError, err)
	}
}

func (s *Server) readFortress(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.fortressView())
}

// joinFortressRoute joins the fortress of a phrase. A phrase that does not
// decode is answered with the reason and the word at fault, as on joining a
// group.
func (s *Server) joinFortressRoute(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phrase string `json:"phrase"`
	}
	if !readBody(w, r, &req) {
		return
	}
	secret, err := phrase.Decode(strings.TrimSpace(req.Phrase))
	var de *phrase.DecodeError
	switch {
	case errors.As(err, &de):
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": de.Error(), "code": string(de.Reason),
			"values": map[string]string{"word": de.Word, "position": strconv.Itoa(de.Position), "count": strconv.Itoa(de.Count)},
		})
		return
	case err != nil:
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.joinFortress(r.Context(), secret); err != nil {
		writeFortressError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.fortressView())
}

// showFortressPhrase shows the phrase again, behind the password as the
// group's phrase is.
func (s *Server) showFortressPhrase(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if r.ContentLength != 0 && !readBody(w, r, &req) {
		return
	}
	if len(s.passwordHash()) > 0 && !s.checkCurrentPassword(w, r, req.Password) {
		return
	}
	st := s.Pairing.Get()
	if !st.Fortress {
		writeFortressError(w, errNoFortress)
		return
	}
	words, err := phrase.Encode(st.Secret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"phrase": words, "code": s.pairingCode(words)})
}

// changeFortressRoute gives the fortress a new phrase. The answer shows it,
// so it asks for the password as showing it does.
func (s *Server) changeFortressRoute(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if r.ContentLength != 0 && !readBody(w, r, &req) {
		return
	}
	if len(s.passwordHash()) > 0 && !s.checkCurrentPassword(w, r, req.Password) {
		return
	}
	words, left, err := s.changeFortressPhrase(r.Context())
	if err != nil {
		writeFortressError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"phrase": words, "code": s.pairingCode(words), "left": left})
}

// maxDeviceName bounds this instance's name in the fortress, as the kit
// bounds an app's.
const maxDeviceName = 64

func (s *Server) nameFortressDevice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Device string `json:"device"`
	}
	if !readBody(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Device)
	if utf8.RuneCountInString(name) > maxDeviceName || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the name must be one line of at most 64 characters", "code": "deviceName"})
		return
	}
	if err := s.Pairing.Update(func(st *pairing.State) error { st.Name = name; return nil }); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	s.applyGroup()
	writeJSON(w, http.StatusOK, s.fortressView())
}

func (s *Server) switchFortressPermission(w http.ResponseWriter, r *http.Request) {
	var req struct {
		From   string `json:"from"`
		To     string `json:"to"`
		Action string `json:"action"`
		On     bool   `json:"on"`
	}
	if !readBody(w, r, &req) {
		return
	}
	f := s.fortressNow()
	if f == nil {
		writeFortressError(w, errNoFortress)
		return
	}
	if err := f.SetPermission(req.From, req.To, req.Action, req.On); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, s.fortressView())
}

// removeFortressRoute takes another member out of the fortress. A page
// another app opened here never reaches it (closedPrefixes), nor does the API
// token.
func (s *Server) removeFortressRoute(w http.ResponseWriter, r *http.Request) {
	if err := s.removeFortressMember(r.PathValue("id")); err != nil {
		writeFortressError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.fortressView())
}

// leaveFortress takes this instance out of the fortress and so out of its
// pairing, which the fortress phrase holds as well. The members in reach drop
// it at once, the others when they hear it from them.
func (s *Server) leaveFortress(w http.ResponseWriter, _ *http.Request) {
	if !s.Pairing.Get().Fortress {
		writeFortressError(w, errNoFortress)
		return
	}
	if f := s.fortressNow(); f != nil {
		f.Leave()
	}
	if err := s.enterGroup(nil); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, s.fortressView())
}
