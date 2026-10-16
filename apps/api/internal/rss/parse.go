package rss

import (
	"bytes"
	"strconv"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"
)

// ParsedFeed is the normalized result of parsing an external podcast feed (RSS importer).
type ParsedFeed struct {
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Link        string         `json:"link"`
	Language    string         `json:"language"`
	Author      string         `json:"author"`
	OwnerName   string         `json:"owner_name"`
	OwnerEmail  string         `json:"owner_email"`
	ImageURL    string         `json:"image_url"`
	Copyright   string         `json:"copyright"`
	Explicit    bool           `json:"explicit"`
	Type        string         `json:"type"`
	Categories  []Category     `json:"categories"`
	Episodes    []ParsedEpisode `json:"episodes"`
}

type ParsedEpisode struct {
	GUID           string    `json:"guid"`
	Title          string    `json:"title"`
	Description    string    `json:"description"`
	Summary        string    `json:"summary"`
	Link           string    `json:"link"`
	AudioURL       string    `json:"audio_url"`
	AudioType      string    `json:"audio_type"`
	AudioLength    int64     `json:"audio_length"`
	Duration       int       `json:"duration"`
	PublishedAt    time.Time `json:"published_at"`
	EpisodeNumber  *int      `json:"episode_number"`
	SeasonNumber   *int      `json:"season_number"`
	EpisodeType    string    `json:"episode_type"`
	Explicit       bool      `json:"explicit"`
	ImageURL       string    `json:"image_url"`
	TranscriptURL  string    `json:"transcript_url"`
	TranscriptType string    `json:"transcript_type"`
}

// Parse parses RSS/Atom bytes into a ParsedFeed.
func Parse(data []byte) (*ParsedFeed, error) {
	f, err := gofeed.NewParser().Parse(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	pf := &ParsedFeed{
		Title:       strings.TrimSpace(f.Title),
		Description: strings.TrimSpace(f.Description),
		Link:        f.Link,
		Language:    normLang(f.Language),
		Copyright:   f.Copyright,
		Type:        "episodic",
	}
	if f.Image != nil {
		pf.ImageURL = f.Image.URL
	}
	if f.Author != nil {
		pf.Author = f.Author.Name
	}
	if it := f.ITunesExt; it != nil {
		if it.Author != "" {
			pf.Author = it.Author
		}
		if it.Image != "" {
			pf.ImageURL = it.Image
		}
		if it.Owner != nil {
			pf.OwnerName, pf.OwnerEmail = it.Owner.Name, it.Owner.Email
		}
		pf.Explicit = parseExplicit(it.Explicit)
		if it.Type == "serial" {
			pf.Type = "serial"
		}
		if pf.Description == "" {
			pf.Description = it.Summary
		}
		for _, c := range it.Categories {
			cat := Category{Name: c.Text}
			if c.Subcategory != nil {
				cat.Sub = c.Subcategory.Text
			}
			pf.Categories = append(pf.Categories, cat)
		}
	}
	for _, item := range f.Items {
		ep := ParsedEpisode{
			GUID:        strings.TrimSpace(item.GUID),
			Title:       strings.TrimSpace(item.Title),
			Description: item.Description,
			Link:        item.Link,
			EpisodeType: "full",
		}
		if item.Content != "" && len(item.Content) > len(ep.Description) {
			ep.Description = item.Content
		}
		if item.PublishedParsed != nil {
			ep.PublishedAt = item.PublishedParsed.UTC()
		} else {
			ep.PublishedAt = time.Now().UTC()
		}
		for _, enc := range item.Enclosures {
			if enc.URL == "" {
				continue
			}
			ep.AudioURL, ep.AudioType = enc.URL, enc.Type
			ep.AudioLength, _ = strconv.ParseInt(enc.Length, 10, 64)
			break
		}
		if item.Image != nil {
			ep.ImageURL = item.Image.URL
		}
		if it := item.ITunesExt; it != nil {
			ep.Duration = ParseDuration(it.Duration)
			ep.Explicit = parseExplicit(it.Explicit)
			ep.Summary = it.Summary
			if it.Image != "" {
				ep.ImageURL = it.Image
			}
			if n, err := strconv.Atoi(strings.TrimSpace(it.Episode)); err == nil {
				ep.EpisodeNumber = &n
			}
			if n, err := strconv.Atoi(strings.TrimSpace(it.Season)); err == nil {
				ep.SeasonNumber = &n
			}
			switch strings.ToLower(it.EpisodeType) {
			case "trailer", "bonus":
				ep.EpisodeType = strings.ToLower(it.EpisodeType)
			}
		}
		if ns, ok := item.Extensions["podcast"]; ok {
			for _, t := range ns["transcript"] {
				ep.TranscriptURL = t.Attrs["url"]
				ep.TranscriptType = t.Attrs["type"]
				break
			}
		}
		if ep.GUID == "" {
			ep.GUID = ep.AudioURL
		}
		if ep.GUID == "" || ep.Title == "" {
			continue
		}
		pf.Episodes = append(pf.Episodes, ep)
	}
	return pf, nil
}

func parseExplicit(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "yes", "true", "explicit":
		return true
	}
	return false
}

func normLang(l string) string {
	l = strings.TrimSpace(l)
	if l == "" {
		return "en"
	}
	return strings.ToLower(l)
}
