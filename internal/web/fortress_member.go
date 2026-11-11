package web

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	kitfortress "github.com/junkerderprovinz/parleyport/kit/fortress"
	"github.com/junkerderprovinz/parleyport/kit/group"
	"github.com/junkerderprovinz/parleyport/kit/lan"
	"github.com/junkerderprovinz/parleyport/kit/member"
	"github.com/junkerderprovinz/parleyport/kit/phrase"

	"github.com/junkerderprovinz/arrowloop/internal/boot"
	"github.com/junkerderprovinz/arrowloop/internal/pairing"
)

var (
	errInFortress = errors.New("this instance is in a fortress already")
	errNoFortress = errors.New("this instance is in no fortress")
)

// moveWait is how often the instances the pairing had before the fortress
// are handed its phrase again, until each of them has it.
var moveWait = time.Minute

// fortressNow is the fortress this instance is in, nil outside one.
func (s *Server) fortressNow() *kitfortress.Fortress {
	s.liveMu.Lock()
	defer s.liveMu.Unlock()
	return s.fort
}

// openFortressLocked opens the fortress st names, and the pairing with it,
// with groupMu held.
func (s *Server) openFortressLocked(st pairing.State, id member.Identity, mode group.RelayMode, relayURL string, gen uint64) {
	var network *lan.Service
	if s.LAN != nil {
		network = lan.New(lan.Config{Group: kitfortress.Multicast, Ports: s.groupPorts()})
		network.Start()
	}
	f, err := kitfortress.Open(kitfortress.Config{
		App:      kitfortress.App{ID: string(pairing.Domain), Name: "ArrowLoop", Version: boot.Version},
		Secret:   st.Secret,
		Previous: st.FortressPrevious,
		Keeper:   fortressKeeper{s},
		Identity: id,
		Self:     s.self(st),
		Relay:    mode,
		RelayURL: relayURL,
		LAN:      network,
		Store:    s.Pairing.FortressStore(),
		Pairing: &kitfortress.Pairing{
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
		},
		Status:    fortressSource{s},
		Actions:   s.FortressActions(),
		Export:    s.FortressExport,
		Import:    s.FortressImport,
		OnRemoved: func() { s.removedFrom(gen) },
	})
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
	if st.MoveFrom != nil {
		ctx, cancel := context.WithCancel(context.Background())
		s.moveStop = cancel
		s.moving.Go(func() { s.move(ctx, st, id, mode, relayURL) })
	}
	s.groupChanged()
}

// closeFortressLocked leaves the fortress, the pairing and the move, with
// groupMu held. It reports whether this instance was in one.
func (s *Server) closeFortressLocked() bool {
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
		if s.generation() == gen {
			s.logf("fortress: another member took this instance out, so it left the fortress")
			_ = s.enterGroupLocked(nil)
		}
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

// joinFortress joins the fortress of secret. The instances paired with this
// one under the app's own phrase are handed the fortress phrase and follow,
// and the pairing moves with them, approvals kept.
func (s *Server) joinFortress(ctx context.Context, secret []byte) error {
	s.groupMu.Lock()
	defer s.groupMu.Unlock()
	st := s.Pairing.Get()
	if st.Fortress {
		return errInFortress
	}
	if old := s.joined(); old != nil {
		ctx, cancel := context.WithTimeout(ctx, relayTimeout)
		took := kitfortress.Move(ctx, old, secret)
		cancel()
		s.logf("fortress: joined a fortress, and %d instances of the group follow", len(took))
	}
	s.closeGroupLocked()
	err := s.Pairing.EnterFortress(secret)
	if err == nil && st.Secret == nil {
		now := time.Now()
		err = s.Pairing.Update(func(stored *pairing.State) error { stored.JoinedAt = now; return nil })
	}
	s.openGroupLocked()
	return err
}

// changeFortressPhrase gives the fortress a new phrase and returns its words
// and the devices that still hold the old one.
func (s *Server) changeFortressPhrase(ctx context.Context) (string, []string, error) {
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

	left := []string{}
	note := func(id, name string) {
		if !slices.Contains(took, id) && !slices.Contains(left, name) {
			left = append(left, name)
		}
	}
	for _, m := range f.Members() {
		if m.Kind == member.KindInstance {
			note(m.ID, m.Device)
		}
	}
	// An instance the pairing never met under the fortress phrase still holds
	// the app's own, and the move brings it the new one.
	for _, m := range paired.Members() {
		if m.Kind == member.KindInstance && m.State == group.StateApproved && !m.Met.IsZero() {
			note(m.ID, m.Name)
		}
	}
	// One still moving in may hold the phrase from before, which no answer
	// it gave proves: it leaves the pairing as it takes the phrase, and the
	// answer can get lost with it.
	for _, m := range moving {
		note(m.ID, m.Name)
	}
	slices.Sort(left)
	s.closeGroupLocked()
	s.openGroupLocked()
	words, err := phrase.Encode(s.Pairing.Get().Secret)
	return words, left, err
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
}

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
	}
	f := s.fortressNow()
	if f == nil {
		return v
	}
	for _, m := range f.Members() {
		if m.State != group.StateApproved || m.App.ID == "" {
			continue
		}
		mv := fortressMemberView{
			ID: m.ID, App: m.App.ID, Name: m.App.Name, Version: m.App.Version, Device: m.Device,
			Deployment: m.Deployment, Kind: string(m.Kind), Online: m.Online(), Relay: m.Relay && !m.Direct,
		}
		if !m.LastSeen.IsZero() {
			mv.LastSeen = m.LastSeen.Unix()
		}
		v.Members = append(v.Members, mv)
	}
	own := string(pairing.Domain)
	for _, p := range f.Permissions() {
		if p.From == own || p.To == own {
			v.Permissions = append(v.Permissions, fortressPermissionView{From: p.From, To: p.To, Action: p.Action, On: p.On})
		}
	}
	return v
}

func (s *Server) fortressRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/fortress", s.readFortress)
	mux.HandleFunc("POST /api/fortress/join", s.joinFortressRoute)
	mux.HandleFunc("POST /api/fortress/phrase/show", s.showFortressPhrase)
	mux.HandleFunc("POST /api/fortress/phrase", s.changeFortressRoute)
	mux.HandleFunc("PUT /api/fortress/device", s.nameFortressDevice)
	mux.HandleFunc("PUT /api/fortress/permissions", s.switchFortressPermission)
	mux.HandleFunc("DELETE /api/fortress", s.leaveFortress)
}

// writeFortressError answers with the code the page words a refusal by.
func writeFortressError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errInFortress):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error(), "code": "inFortress"})
	case errors.Is(err, errNoFortress):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error(), "code": "noFortress"})
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

// leaveFortress takes this instance out of the fortress and so out of its
// pairing, which the fortress phrase holds as well.
func (s *Server) leaveFortress(w http.ResponseWriter, _ *http.Request) {
	if !s.Pairing.Get().Fortress {
		writeFortressError(w, errNoFortress)
		return
	}
	if err := s.enterGroup(nil); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, s.fortressView())
}
