package hold

import (
	"context"
	"errors"
	"net/netip"
	"testing"
	"time"

	"github.com/junkerderprovinz/arrowloop/internal/job"
)

// at builds a store whose clock the test moves by hand.
func at(start time.Time) (*Store, *time.Time) {
	now := start
	s := New()
	s.now = func() time.Time { return now }
	return s, &now
}

func TestNothingReportedHoldsNothing(t *testing.T) {
	if err := New().Condition()(context.Background(), job.Job{}); err != nil {
		t.Fatalf("a store nothing was reported to held a run: %v", err)
	}
}

func TestAReportedReasonHoldsARun(t *testing.T) {
	s, _ := at(time.Now())
	s.Report("this phone is on battery", false, Wifi{})

	err := s.Condition()(context.Background(), job.Job{})
	if err == nil {
		t.Fatal("a reported reason did not hold the run")
	}
	// The log needs the reporter's words to say which condition stopped it.
	if err.Error() != "this phone is on battery" {
		t.Fatalf("the reason was rewritten: %q", err.Error())
	}
}

func TestAnEmptyReportClearsTheHold(t *testing.T) {
	s, _ := at(time.Now())
	s.Report("this phone is on battery", false, Wifi{})
	s.Report("", false, Wifi{})

	if err := s.Condition()(context.Background(), job.Job{}); err != nil {
		t.Fatalf("the hold survived being cleared: %v", err)
	}
}

// A killed app stops reporting, so its last hold must expire.
func TestAStaleReportStopsHolding(t *testing.T) {
	s, now := at(time.Now())
	s.Report("this phone is on battery", false, Wifi{})

	*now = now.Add(Stale - time.Minute)
	if err := s.Condition()(context.Background(), job.Job{}); err == nil {
		t.Fatal("the hold expired early, while the report was still fresh")
	}

	*now = now.Add(2 * time.Minute)
	if err := s.Condition()(context.Background(), job.Job{}); err != nil {
		t.Fatalf("a report older than %v still held a run: %v", Stale, err)
	}
}

func TestTheStateSaysWhatTheConditionDoes(t *testing.T) {
	s, now := at(time.Now())
	s.Report("this connection is metered", false, Wifi{})

	if got := s.State(); got.Reason != "this connection is metered" || got.Stale {
		t.Fatalf("a fresh report read back wrong: %+v", got)
	}

	*now = now.Add(Stale + time.Second)
	if got := s.State(); !got.Stale {
		t.Fatalf("a state a run would ignore did not say it was stale: %+v", got)
	}
}

// A phone without a network holds the jobs that reach a server, and only them.
func TestNoNetworkHoldsOnlyJobsThatNeedOne(t *testing.T) {
	s, _ := at(time.Now())
	s.Report("", true, Wifi{})

	remote := job.Job{Left: t.TempDir(), Right: "cloud:photos"}
	if err := s.Condition()(context.Background(), remote); !errors.Is(err, job.ErrNoNetwork) {
		t.Errorf("a job with a server side came to %v with no network, want ErrNoNetwork", err)
	}
	local := job.Job{Left: t.TempDir(), Right: t.TempDir()}
	if err := s.Condition()(context.Background(), local); err != nil {
		t.Errorf("a job between two folders on the phone was held for want of a network: %v", err)
	}

	s.Report("", false, Wifi{})
	if err := s.Condition()(context.Background(), remote); err != nil {
		t.Errorf("the network came back and the job was still held: %v", err)
	}
}

// Android can freeze the app together with its engine. The app's last report
// then predates the network going away, and on thawing the engine's clock
// starts a run before the app has caught up, so the engine looks for a route
// itself.
func TestNoRouteHoldsJobsThatNeedANetworkWhateverWasReported(t *testing.T) {
	s, now := at(time.Now())
	routed := false
	s.CheckRoutes(func() bool { return routed })
	remote := job.Job{Left: t.TempDir(), Right: "cloud:photos"}
	local := job.Job{Left: t.TempDir(), Right: t.TempDir()}
	held := func(j job.Job) error { return s.Condition()(context.Background(), j) }

	if err := held(remote); !errors.Is(err, job.ErrNoNetwork) {
		t.Errorf("before any report, a job with a server side came to %v, want ErrNoNetwork", err)
	}
	s.Report("", false, Wifi{})
	if err := held(remote); !errors.Is(err, job.ErrNoNetwork) {
		t.Errorf("a report of a network that is gone let the job through: %v", err)
	}
	*now = now.Add(Stale + time.Minute)
	if err := held(remote); !errors.Is(err, job.ErrNoNetwork) {
		t.Errorf("a stale report let the job through with no route: %v", err)
	}
	if err := held(local); err != nil {
		t.Errorf("a job between two folders on the phone was held for want of a route: %v", err)
	}

	routed = true
	if err := held(remote); err != nil {
		t.Errorf("the route came back and the job was still held: %v", err)
	}
}

// A route says nothing about the charger or a metered connection, so the
// reported reason still holds.
func TestARouteDoesNotLiftAReportedReason(t *testing.T) {
	s, _ := at(time.Now())
	s.CheckRoutes(func() bool { return true })
	s.Report("this phone is not charging", false, Wifi{})

	if err := s.Condition()(context.Background(), job.Job{Left: t.TempDir(), Right: "cloud:photos"}); err == nil {
		t.Error("having a route lifted the reported reason")
	}
}

// home is a report from a phone on the wifi called Home.
func home(s *Store) {
	s.Report("", false, Wifi{Name: "Home", Addresses: []netip.Addr{netip.MustParseAddr("192.168.1.23"), netip.MustParseAddr("fe80::1%wlan0")}})
}

func leavingFrom(s *Store, addrs ...string) {
	s.leaves = func() []netip.Addr {
		out := []netip.Addr{}
		for _, a := range addrs {
			out = append(out, netip.MustParseAddr(a))
		}
		return out
	}
}

func TestAReportedWifiIsTheOneTrafficLeavesBy(t *testing.T) {
	s, _ := at(time.Now())
	leavingFrom(s, "192.168.1.23")
	home(s)
	if got := s.Wifi(); got != "Home" {
		t.Fatalf("the wifi is %q, want Home", got)
	}
}

func TestNoWifiIsKnownBeforeAReport(t *testing.T) {
	s, _ := at(time.Now())
	leavingFrom(s, "192.168.1.23")
	if got := s.Wifi(); got != "" {
		t.Fatalf("with nothing reported the wifi is %q", got)
	}
	s.Report("", false, Wifi{})
	if got := s.Wifi(); got != "" {
		t.Fatalf("after a report without a wifi it is %q", got)
	}
}

func TestAStaleWifiIsNotBelieved(t *testing.T) {
	s, now := at(time.Now())
	leavingFrom(s, "192.168.1.23")
	home(s)
	*now = now.Add(Stale + time.Second)
	if got := s.Wifi(); got != "" {
		t.Fatalf("a report older than %v still says %q", Stale, got)
	}
}

// Android can freeze the app with its engine, so the report may still name the
// wifi at home while the phone is out on mobile data. The engine then sees its
// traffic leave from an address the phone did not report for that wifi.
func TestAWifiTheTrafficNoLongerLeavesByIsNotBelieved(t *testing.T) {
	s, _ := at(time.Now())
	home(s)

	leavingFrom(s, "10.64.12.7")
	if got := s.Wifi(); got != "" {
		t.Errorf("leaving from a mobile address, the wifi is %q", got)
	}
	leavingFrom(s, "192.168.1.23", "2a02:8070::5")
	if got := s.Wifi(); got != "" {
		t.Errorf("with IPv6 leaving elsewhere, the wifi is %q", got)
	}
	leavingFrom(s)
	if got := s.Wifi(); got != "" {
		t.Errorf("with no way out at all, the wifi is %q", got)
	}
}

func TestAnAddressInIPv6FormStillMatches(t *testing.T) {
	s, _ := at(time.Now())
	leavingFrom(s, "::ffff:192.168.1.23")
	home(s)
	if got := s.Wifi(); got != "Home" {
		t.Fatalf("the wifi is %q, want Home", got)
	}
}

func TestTheFirstReportIsAwaitable(t *testing.T) {
	s := New()
	reported := s.Reported()
	select {
	case <-reported:
		t.Fatal("a store nothing was reported to says it has a report")
	default:
	}
	s.Report("", false, Wifi{})
	s.Report("this phone is on battery", false, Wifi{})
	select {
	case <-reported:
	default:
		t.Fatal("the first report was not told")
	}
}
