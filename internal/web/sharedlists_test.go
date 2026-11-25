package web_test

import "testing"

const emptyPhotos = `{"excludeSets":{"Photos":[]},"jobs":[{"name":"camera","left":"%[1]s/left","right":"%[1]s/right","state":"%[1]s/camera.db","quietPeriod":"0s","direction":"leftToRight","mode":"move","includeSets":["Photos"]}]}`

func TestTheJobListWarnsOfAJobThatIncludesNothing(t *testing.T) {
	h := engineFor(t, emptyPhotos)
	var jobs []struct {
		Name            string
		IncludesNothing bool
	}
	h.get(t, "/api/jobs", &jobs)
	if len(jobs) != 1 || !jobs[0].IncludesNothing {
		t.Fatalf("the job list does not warn that the job takes no files: %+v", jobs)
	}
}

// A move job left with an empty include list would otherwise carry off the
// whole folder.
func TestAMoveJobWithAnEmptyIncludeListPlansNothing(t *testing.T) {
	h := engineFor(t, emptyPhotos)
	write(t, h.left, "DCIM/a.jpg", "a photo")
	write(t, h.left, "notes.txt", "a note")
	var view struct {
		Actions []struct{ Path string }
	}
	h.get(t, "/api/jobs/camera/plan", &view)
	if len(view.Actions) != 0 {
		t.Fatalf("a job whose only include list is empty plans %+v", view.Actions)
	}
}
