package rss

import (
	"strings"
	"testing"
	"time"
)

func sampleChannel() Channel {
	n, s := 3, 1
	return Channel{
		Title: "My Business Podcast", Link: "https://podcastbusiness.com/podcast/my-business-podcast",
		FeedURL: "https://podcastbusiness.com/feed/my-business-podcast.xml", Description: "Founder interviews & <b>growth</b>",
		Language: "en", Author: "Sarah", OwnerName: "Sarah", OwnerEmail: "sarah@example.com",
		ImageURL: "https://cdn.example.com/art.jpg", Categories: []Category{{Name: "Business", Sub: "Entrepreneurship"}},
		Type: "episodic", GUID: "6f1c7a3e-0000-4000-8000-000000000000", LastBuild: time.Now(),
		Items: []Item{{Title: "Ep ]]> 1", GUID: "guid-1", DescriptionHTML: "<p>Hello</p>", EnclosureURL: "https://cdn.example.com/a.mp3",
			EnclosureLength: 12345, EnclosureType: "audio/mpeg", Duration: 61, PubDate: time.Now(), EpisodeNumber: &n, SeasonNumber: &s,
			EpisodeType: "full", TranscriptURL: "https://x/t.vtt", TranscriptType: "text/vtt"}},
	}
}

func TestGeneratedFeedValidates(t *testing.T) {
	xml := Generate(sampleChannel())
	res := Validate(xml)
	if !res.Valid || res.Warnings != 0 {
		t.Fatalf("expected valid feed without warnings, got %+v\n%s", res, xml)
	}
	for _, must := range []string{"<itunes:episode>3</itunes:episode>", "<itunes:season>1</itunes:season>", `isPermaLink="false">guid-1<`,
		`<enclosure url="https://cdn.example.com/a.mp3" length="12345" type="audio/mpeg"/>`, "<itunes:explicit>false</itunes:explicit>",
		`<itunes:category text="Business">`, "<podcast:guid>", "<itunes:duration>61</itunes:duration>"} {
		if !strings.Contains(string(xml), must) {
			t.Errorf("feed missing %s", must)
		}
	}
}

func TestGeneratedFeedRoundTripsThroughParser(t *testing.T) {
	pf, err := Parse(Generate(sampleChannel()))
	if err != nil {
		t.Fatal(err)
	}
	if pf.Title != "My Business Podcast" || len(pf.Episodes) != 1 || pf.OwnerEmail != "sarah@example.com" {
		t.Fatalf("unexpected parse %+v", pf)
	}
	ep := pf.Episodes[0]
	if ep.GUID != "guid-1" || ep.Duration != 61 || *ep.EpisodeNumber != 3 || ep.Title != "Ep ]]> 1" || ep.TranscriptURL == "" {
		t.Fatalf("unexpected episode %+v", ep)
	}
}

func TestValidatorCatchesProblems(t *testing.T) {
	ch := sampleChannel()
	ch.OwnerEmail = ""
	ch.Categories = nil
	ch.Items = append(ch.Items, ch.Items[0]) // duplicate GUID
	res := Validate(Generate(ch))
	if res.Valid {
		t.Fatal("expected invalid feed")
	}
	want := map[string]bool{"channel.itunes:owner": false, "channel.itunes:category": false, "item[1].guid": false}
	for _, is := range res.Issues {
		if _, ok := want[is.Field]; ok {
			want[is.Field] = true
		}
	}
	for f, seen := range want {
		if !seen {
			t.Errorf("expected issue for %s; got %+v", f, res.Issues)
		}
	}
	if Validate([]byte("<rss><channel>")).Valid {
		t.Error("malformed XML must be invalid")
	}
}

func TestParseDuration(t *testing.T) {
	for in, want := range map[string]int{"61": 61, "01:01": 61, "1:00:01": 3601, "": 0, "12.7": 12} {
		if got := ParseDuration(in); got != want {
			t.Errorf("ParseDuration(%q)=%d want %d", in, got, want)
		}
	}
}
