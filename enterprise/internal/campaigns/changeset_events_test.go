package campaigns

import (
	"github.com/sourcegraph/sourcegraph/internal/extsvc/bitbucketserver"
	"sort"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
	cmpgn "github.com/sourcegraph/sourcegraph/internal/campaigns"
	"github.com/sourcegraph/sourcegraph/internal/extsvc/github"
)

func TestChangesetEventsLabels(t *testing.T) {
	now := time.Now()
	labelEvent := func(name string, kind cmpgn.ChangesetEventKind, when time.Time) *cmpgn.ChangesetEvent {
		removed := kind == cmpgn.ChangesetEventKindGitHubUnlabeled
		return &cmpgn.ChangesetEvent{
			Kind:      kind,
			UpdatedAt: when,
			Metadata: &github.LabelEvent{
				Actor: github.Actor{},
				Label: github.Label{
					Name: name,
				},
				CreatedAt: when,
				Removed:   removed,
			},
		}
	}
	changeset := func(names []string, updated time.Time) *cmpgn.Changeset {
		meta := &github.PullRequest{}
		for _, name := range names {
			meta.Labels.Nodes = append(meta.Labels.Nodes, github.Label{
				Name: name,
			})
		}
		return &cmpgn.Changeset{
			UpdatedAt: updated,
			Metadata:  meta,
		}
	}
	labels := func(names ...string) []cmpgn.ChangesetLabel {
		var ls []cmpgn.ChangesetLabel
		for _, name := range names {
			ls = append(ls, cmpgn.ChangesetLabel{Name: name})
		}
		return ls
	}

	tests := []struct {
		name      string
		changeset *cmpgn.Changeset
		events    ChangesetEvents
		want      []cmpgn.ChangesetLabel
	}{
		{
			name: "zero values",
		},
		{
			name:      "no events",
			changeset: changeset([]string{"label1"}, time.Time{}),
			events:    ChangesetEvents{},
			want:      labels("label1"),
		},
		{
			name:      "remove event",
			changeset: changeset([]string{"label1"}, time.Time{}),
			events: ChangesetEvents{
				labelEvent("label1", cmpgn.ChangesetEventKindGitHubUnlabeled, now),
			},
			want: []cmpgn.ChangesetLabel{},
		},
		{
			name:      "add event",
			changeset: changeset([]string{"label1"}, time.Time{}),
			events: ChangesetEvents{
				labelEvent("label2", cmpgn.ChangesetEventKindGitHubLabeled, now),
			},
			want: labels("label1", "label2"),
		},
		{
			name:      "old add event",
			changeset: changeset([]string{"label1"}, now.Add(5*time.Minute)),
			events: ChangesetEvents{
				labelEvent("label2", cmpgn.ChangesetEventKindGitHubLabeled, now),
			},
			want: labels("label1"),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			have := tc.events.UpdateLabelsSince(tc.changeset)
			want := tc.want
			sort.Slice(have, func(i, j int) bool { return have[i].Name < have[j].Name })
			sort.Slice(want, func(i, j int) bool { return want[i].Name < want[j].Name })
			if diff := cmp.Diff(have, want, cmpopts.EquateEmpty()); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestFindMergeCommitID(t *testing.T) {
	now := time.Now()
	makeBitbucketEvent := func(kind cmpgn.ChangesetEventKind, commit string) *cmpgn.ChangesetEvent {
		return &cmpgn.ChangesetEvent{
			ID:          1,
			ChangesetID: 1,
			Kind:        kind,
			Key:         "key",
			CreatedAt:   now,
			UpdatedAt:   now,
			Metadata: &bitbucketserver.Activity{
				ID: 1,
				Commit: &bitbucketserver.Commit{
					ID: commit,
				},
			},
		}
	}
	makeGitHubMergeEvent := func(commit string) *cmpgn.ChangesetEvent {
		return &cmpgn.ChangesetEvent{
			ID:          1,
			ChangesetID: 1,
			Kind:        cmpgn.ChangesetEventKindBitbucketServerMerged,
			Key:         "key",
			CreatedAt:   now,
			UpdatedAt:   now,
			Metadata: &github.MergedEvent{
				Commit: github.Commit{
					OID: commit,
				},
			},
		}
	}
	makeOtherGitHubEvent := func() *cmpgn.ChangesetEvent {
		return &cmpgn.ChangesetEvent{
			ID:          1,
			ChangesetID: 1,
			Kind:        cmpgn.ChangesetEventKindGitHubCommented,
			Key:         "key",
			CreatedAt:   now,
			UpdatedAt:   now,
			Metadata:    &github.PullRequestReviewComment{},
		}
	}
	for _, tc := range []struct {
		name   string
		events ChangesetEvents
		want   string
	}{
		{
			name:   "nil events",
			events: nil,
			want:   "",
		},
		{
			name:   "no events",
			events: ChangesetEvents{},
			want:   "",
		},
		{
			name: "one bitbucket merge event",
			events: ChangesetEvents{
				makeBitbucketEvent(cmpgn.ChangesetEventKindBitbucketServerMerged, "deadbeef"),
			},
			want: "deadbeef",
		},
		{
			name: "multiple bitbucket events with merge",
			events: ChangesetEvents{
				makeBitbucketEvent(cmpgn.ChangesetEventKindBitbucketServerApproved, ""),
				makeBitbucketEvent(cmpgn.ChangesetEventKindBitbucketServerMerged, "deadbeef"),
			},
			want: "deadbeef",
		},
		{
			name: "multiple bitbucket events no merge",
			events: ChangesetEvents{
				makeBitbucketEvent(cmpgn.ChangesetEventKindBitbucketServerApproved, ""),
				makeBitbucketEvent(cmpgn.ChangesetEventKindBitbucketServerCommented, ""),
			},
			want: "",
		},
		{
			name: "one github merge event",
			events: ChangesetEvents{
				makeGitHubMergeEvent("deadbeef"),
			},
			want: "deadbeef",
		},
		{
			name: "multiple github events with merge",
			events: ChangesetEvents{
				makeOtherGitHubEvent(),
				makeGitHubMergeEvent("deadbeef"),
			},
			want: "deadbeef",
		},
		{
			name: "multiple github events no merge",
			events: ChangesetEvents{
				makeOtherGitHubEvent(),
				makeOtherGitHubEvent(),
			},
			want: "",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			have := tc.events.FindMergeCommitID()
			if have != tc.want {
				t.Fatalf("Want %q, have %q", tc.want, have)
			}
		})
	}
}
