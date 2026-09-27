package daemon

import (
	"encoding/json"
	"testing"
	"time"
)

func TestTheSpeedIsTheBytesOverTheLastFewSeconds(t *testing.T) {
	var gauge speedometer
	start := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	gauge.read(start, 0)

	// A steady megabyte a second, read twice a second.
	var got int64
	for i := 1; i <= 10; i++ {
		got = gauge.read(start.Add(time.Duration(i)*500*time.Millisecond), int64(i)*512*1024)
	}
	if got != 1024*1024 {
		t.Errorf("a steady megabyte a second reads %d", got)
	}
	if len(gauge.seen) > 8 {
		t.Errorf("the gauge keeps %d readings, which is more than its span needs", len(gauge.seen))
	}
}

// Nothing moving is no speed, once the last bytes are older than the span, so
// the card shows none instead of the last one for ever.
func TestTheSpeedFallsToNothingWhenTheBytesStop(t *testing.T) {
	var gauge speedometer
	start := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	gauge.read(start, 0)
	gauge.read(start.Add(time.Second), 4096)

	var got int64
	for i := 2; i <= 2+int(speedSpan/time.Second)+1; i++ {
		got = gauge.read(start.Add(time.Duration(i)*time.Second), 4096)
	}
	if got != 0 {
		t.Errorf("with no bytes for longer than the span the speed reads %d", got)
	}
}

// rclone may reset its counters; a negative speed would read as nonsense.
func TestACountThatGoesDownStartsTheMeasurementAgain(t *testing.T) {
	var gauge speedometer
	start := time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)
	gauge.read(start, 10_000)
	if got := gauge.read(start.Add(time.Second), 100); got != 0 {
		t.Errorf("a reset count reads %d", got)
	}
	if got := gauge.read(start.Add(2*time.Second), 1100); got != 1000 {
		t.Errorf("after the reset a kilobyte a second reads %d", got)
	}
}

func TestAMovingFrameCarriesTheSpeedOnlyWhileBytesMove(t *testing.T) {
	raw, err := json.Marshal(Event{Job: "Fotos", Phase: "moving", Speed: 3_500_000})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back["speed"] != float64(3_500_000) {
		t.Errorf("the speed came back as %v: %s", back["speed"], raw)
	}

	still, err := json.Marshal(Event{Job: "Fotos", Phase: "moving"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var second map[string]any
	if err := json.Unmarshal(still, &second); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, there := second["speed"]; there {
		t.Errorf("a frame with nothing moving carried a speed: %s", still)
	}
}
