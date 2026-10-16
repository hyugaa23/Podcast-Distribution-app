// Package rss generates, validates and parses podcast RSS feeds (PRD §17–19, §96, §116).
package rss

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type Category struct {
	Name string `json:"name"`
	Sub  string `json:"sub"`
}

type Channel struct {
	Title       string
	Link        string
	FeedURL     string
	Description string
	Language    string
	Copyright   string
	Author      string
	OwnerName   string
	OwnerEmail  string
	ImageURL    string
	Categories  []Category
	Explicit    bool
	Type        string // episodic | serial
	GUID        string // podcast:guid
	LastBuild   time.Time
	Items       []Item
}

type Item struct {
	Title           string
	Link            string
	GUID            string
	DescriptionHTML string
	Summary         string
	EnclosureURL    string
	EnclosureLength int64
	EnclosureType   string
	Duration        int
	PubDate         time.Time
	EpisodeNumber   *int
	SeasonNumber    *int
	EpisodeType     string
	Explicit        bool
	ImageURL        string
	TranscriptURL   string
	TranscriptType  string
}

func esc(s string) string {
	var b bytes.Buffer
	xml.EscapeText(&b, []byte(s))
	return b.String()
}

func cdata(s string) string {
	if s == "" {
		return ""
	}
	// Strip invalid XML 1.0 characters
	s = strings.Map(func(r rune) rune {
		if r == 0x09 || r == 0x0A || r == 0x0D || (r >= 0x20 && r <= 0xD7FF) || (r >= 0xE000 && r <= 0xFFFD) || (r >= 0x10000 && r <= 0x10FFFF) {
			return r
		}
		return -1
	}, s)
	return "<![CDATA[" + strings.ReplaceAll(s, "]]>", "]]]]><![CDATA[>") + "]]>"
}

func yesNo(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// Generate renders a feed compatible with Apple Podcasts, Spotify and Podcast Index.
func Generate(ch Channel) []byte {
	var b strings.Builder
	w := func(format string, a ...any) { fmt.Fprintf(&b, format, a...) }

	w(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	w(`<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" ` +
		`xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:atom="http://www.w3.org/2005/Atom" ` +
		`xmlns:content="http://purl.org/rss/1.0/modules/content/">` + "\n")
	w("<channel>\n")
	w("  <title>%s</title>\n", esc(ch.Title))
	w("  <link>%s</link>\n", esc(ch.Link))
	if ch.FeedURL != "" {
		w(`  <atom:link href="%s" rel="self" type="application/rss+xml"/>`+"\n", esc(ch.FeedURL))
	}
	w("  <description>%s</description>\n", cdata(ch.Description))
	w("  <language>%s</language>\n", esc(ch.Language))
	if ch.Copyright != "" {
		w("  <copyright>%s</copyright>\n", esc(ch.Copyright))
	}
	w("  <lastBuildDate>%s</lastBuildDate>\n", ch.LastBuild.UTC().Format(time.RFC1123Z))
	w("  <generator>Podcast Platform Engine</generator>\n")
	if ch.GUID != "" {
		w("  <podcast:guid>%s</podcast:guid>\n", esc(ch.GUID))
	}
	if ch.Author != "" {
		w("  <itunes:author>%s</itunes:author>\n", esc(ch.Author))
	}
	w("  <itunes:summary>%s</itunes:summary>\n", cdata(ch.Description))
	w("  <itunes:type>%s</itunes:type>\n", esc(orDefault(ch.Type, "episodic")))
	if ch.OwnerName != "" || ch.OwnerEmail != "" {
		w("  <itunes:owner>\n    <itunes:name>%s</itunes:name>\n    <itunes:email>%s</itunes:email>\n  </itunes:owner>\n",
			esc(ch.OwnerName), esc(ch.OwnerEmail))
	}
	if ch.ImageURL != "" {
		w(`  <itunes:image href="%s"/>`+"\n", esc(ch.ImageURL))
		w("  <image>\n    <url>%s</url>\n    <title>%s</title>\n    <link>%s</link>\n  </image>\n",
			esc(ch.ImageURL), esc(ch.Title), esc(ch.Link))
	}
	for _, c := range ch.Categories {
		if c.Sub != "" {
			w(`  <itunes:category text="%s">`+"\n"+`    <itunes:category text="%s"/>`+"\n  </itunes:category>\n", esc(c.Name), esc(c.Sub))
		} else {
			w(`  <itunes:category text="%s"/>`+"\n", esc(c.Name))
		}
	}
	w("  <itunes:explicit>%s</itunes:explicit>\n", yesNo(ch.Explicit))

	for _, it := range ch.Items {
		w("  <item>\n")
		w("    <title>%s</title>\n", esc(it.Title))
		if it.Link != "" {
			w("    <link>%s</link>\n", esc(it.Link))
		}
		w(`    <guid isPermaLink="false">%s</guid>`+"\n", esc(it.GUID))
		w("    <pubDate>%s</pubDate>\n", it.PubDate.UTC().Format(time.RFC1123Z))
		w("    <description>%s</description>\n", cdata(it.DescriptionHTML))
		w("    <content:encoded>%s</content:encoded>\n", cdata(it.DescriptionHTML))
		if it.Summary != "" {
			w("    <itunes:summary>%s</itunes:summary>\n", cdata(it.Summary))
		}
		w(`    <enclosure url="%s" length="%d" type="%s"/>`+"\n", esc(it.EnclosureURL), it.EnclosureLength, esc(orDefault(it.EnclosureType, "audio/mpeg")))
		w("    <itunes:title>%s</itunes:title>\n", esc(it.Title))
		w("    <itunes:duration>%d</itunes:duration>\n", it.Duration)
		if it.EpisodeNumber != nil {
			w("    <itunes:episode>%d</itunes:episode>\n", *it.EpisodeNumber)
		}
		if it.SeasonNumber != nil {
			w("    <itunes:season>%d</itunes:season>\n", *it.SeasonNumber)
		}
		w("    <itunes:episodeType>%s</itunes:episodeType>\n", esc(orDefault(it.EpisodeType, "full")))
		w("    <itunes:explicit>%s</itunes:explicit>\n", yesNo(it.Explicit))
		if it.ImageURL != "" {
			w(`    <itunes:image href="%s"/>`+"\n", esc(it.ImageURL))
		}
		if it.TranscriptURL != "" {
			w(`    <podcast:transcript url="%s" type="%s"/>`+"\n", esc(it.TranscriptURL), esc(it.TranscriptType))
		}
		w("  </item>\n")
	}
	w("</channel>\n</rss>\n")
	return []byte(b.String())
}

func orDefault(s, d string) string {
	if strings.TrimSpace(s) == "" {
		return d
	}
	return s
}

// TranscriptMIME maps a transcript format to its MIME type (Podcasting 2.0).
func TranscriptMIME(format string) string {
	switch format {
	case "srt":
		return "application/x-subrip"
	case "vtt":
		return "text/vtt"
	default:
		return "text/plain"
	}
}

// ParseDuration converts itunes:duration values (seconds, MM:SS, HH:MM:SS) to seconds.
func ParseDuration(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	if n, err := strconv.ParseFloat(s, 64); err == nil {
		return int(n)
	}
	parts := strings.Split(s, ":")
	total := 0
	for _, p := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(strings.Split(p, ".")[0]))
		if err != nil {
			return 0
		}
		total = total*60 + n
	}
	return total
}
