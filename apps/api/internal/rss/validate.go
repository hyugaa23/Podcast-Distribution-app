package rss

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"net/mail"
	"strings"
	"time"
)

// Issue is a single validation finding.
type Issue struct {
	Severity string `json:"severity"` // error | warning
	Field    string `json:"field"`
	Message  string `json:"message"`
}

type Result struct {
	Valid    bool    `json:"valid"`
	Issues   []Issue `json:"issues"`
	Items    int     `json:"items"`
	Errors   int     `json:"errors"`
	Warnings int     `json:"warnings"`
}

type xImage struct {
	Href string `xml:"href,attr"`
}
type xCategory struct {
	Text string      `xml:"text,attr"`
	Subs []xCategory `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd category"`
}
type xEnclosure struct {
	URL    string `xml:"url,attr"`
	Length string `xml:"length,attr"`
	Type   string `xml:"type,attr"`
}
type xItem struct {
	Title     string      `xml:"title"`
	GUID      string      `xml:"guid"`
	PubDate   string      `xml:"pubDate"`
	Enclosure *xEnclosure `xml:"enclosure"`
	Duration  string      `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd duration"`
	Explicit  string      `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd explicit"`
}
type xOwner struct {
	Name  string `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd name"`
	Email string `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd email"`
}
type xLink struct {
	XMLName xml.Name
	Value   string `xml:",chardata"`
}

// plainLink returns the RSS <link> (ignoring namespaced atom:link elements).
func (c xChannel) plainLink() string {
	for _, l := range c.Links {
		if l.XMLName.Space == "" && strings.TrimSpace(l.Value) != "" {
			return strings.TrimSpace(l.Value)
		}
	}
	return ""
}

type xChannel struct {
	Title       string      `xml:"title"`
	Links       []xLink     `xml:"link"`
	Description string      `xml:"description"`
	Language    string      `xml:"language"`
	Author      string      `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd author"`
	Image       *xImage     `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd image"`
	Categories  []xCategory `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd category"`
	Explicit    string      `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd explicit"`
	Owner       *xOwner     `xml:"http://www.itunes.com/dtds/podcast-1.0.dtd owner"`
	Items       []xItem     `xml:"item"`
}
type xRSS struct {
	XMLName xml.Name `xml:"rss"`
	Version string   `xml:"version,attr"`
	Channel xChannel `xml:"channel"`
}

// AppleCategories is the set of top-level Apple Podcasts categories.
var AppleCategories = map[string]bool{
	"Arts": true, "Business": true, "Comedy": true, "Education": true, "Fiction": true, "Government": true,
	"History": true, "Health & Fitness": true, "Kids & Family": true, "Leisure": true, "Music": true,
	"News": true, "Religion & Spirituality": true, "Science": true, "Society & Culture": true,
	"Sports": true, "Technology": true, "True Crime": true, "TV & Film": true,
}

// Validate checks a feed against the requirements of major podcast directories.
// This is the project's feed validator (PRD §119.6).
func Validate(data []byte) Result {
	var r Result
	add := func(sev, field, msg string) {
		r.Issues = append(r.Issues, Issue{Severity: sev, Field: field, Message: msg})
		if sev == "error" {
			r.Errors++
		} else {
			r.Warnings++
		}
	}

	// Well-formedness check over the whole document.
	dec := xml.NewDecoder(bytes.NewReader(data))
	dec.Strict = true
	for {
		_, err := dec.Token()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			add("error", "xml", "XML is not well-formed: "+err.Error())
			r.Valid = false
			return r
		}
	}

	var doc xRSS
	if err := xml.Unmarshal(data, &doc); err != nil {
		add("error", "xml", "Document is not an RSS feed: "+err.Error())
		return r
	}
	if doc.Version != "2.0" {
		add("error", "rss.version", "RSS version must be 2.0")
	}
	c := doc.Channel
	req := func(v, field, label string) {
		if strings.TrimSpace(v) == "" {
			add("error", field, label+" is required")
		}
	}
	req(c.Title, "channel.title", "Podcast title")
	req(c.Description, "channel.description", "Description")
	req(c.plainLink(), "channel.link", "Website link")
	req(c.Language, "channel.language", "Language")
	if c.Image == nil || strings.TrimSpace(c.Image.Href) == "" {
		add("error", "channel.itunes:image", "Artwork (itunes:image) is required")
	} else if !strings.HasPrefix(c.Image.Href, "http") {
		add("error", "channel.itunes:image", "Artwork URL must be absolute")
	} else if !strings.HasPrefix(c.Image.Href, "https://") {
		add("warning", "channel.itunes:image", "Artwork should be served over HTTPS")
	}
	if len(c.Categories) == 0 {
		add("error", "channel.itunes:category", "At least one category is required")
	}
	for _, cat := range c.Categories {
		if !AppleCategories[cat.Text] {
			add("warning", "channel.itunes:category", fmt.Sprintf("Category %q is not an Apple Podcasts category", cat.Text))
		}
	}
	if e := strings.ToLower(strings.TrimSpace(c.Explicit)); e != "true" && e != "false" {
		add("error", "channel.itunes:explicit", "Explicit must be 'true' or 'false'")
	}
	if strings.TrimSpace(c.Author) == "" {
		add("warning", "channel.itunes:author", "Author is recommended")
	}
	if c.Owner == nil || strings.TrimSpace(c.Owner.Email) == "" {
		add("error", "channel.itunes:owner", "Owner email is required for directory verification")
	} else if _, err := mail.ParseAddress(c.Owner.Email); err != nil {
		add("error", "channel.itunes:owner", "Owner email is invalid")
	}

	r.Items = len(c.Items)
	if len(c.Items) == 0 {
		add("error", "channel.item", "Feed must contain at least one episode")
	}
	seen := map[string]bool{}
	for i, it := range c.Items {
		f := fmt.Sprintf("item[%d]", i)
		if strings.TrimSpace(it.Title) == "" {
			add("error", f+".title", "Episode title is required")
		}
		g := strings.TrimSpace(it.GUID)
		if g == "" {
			add("error", f+".guid", "Episode GUID is required")
		} else if seen[g] {
			add("error", f+".guid", "Duplicate episode GUID "+g)
		}
		seen[g] = true
		if it.Enclosure == nil || it.Enclosure.URL == "" {
			add("error", f+".enclosure", "Audio enclosure is required")
		} else {
			if !strings.HasPrefix(it.Enclosure.URL, "http") {
				add("error", f+".enclosure", "Enclosure URL must be absolute")
			}
			if !strings.HasPrefix(it.Enclosure.Type, "audio/") && !strings.HasPrefix(it.Enclosure.Type, "video/") {
				add("error", f+".enclosure", "Enclosure type must be an audio MIME type")
			}
			if it.Enclosure.Length == "" || it.Enclosure.Length == "0" {
				add("warning", f+".enclosure", "Enclosure length should be the file size in bytes")
			}
		}
		if _, err := parseRFC822(it.PubDate); err != nil {
			add("error", f+".pubDate", "Publish date must be RFC 2822 formatted")
		}
		if ParseDuration(it.Duration) <= 0 {
			add("warning", f+".itunes:duration", "Duration is recommended")
		}
	}
	r.Valid = r.Errors == 0
	return r
}

func parseRFC822(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	for _, layout := range []string{time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822,
		"Mon, 2 Jan 2006 15:04:05 -0700", "Mon, 2 Jan 2006 15:04:05 MST"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("bad date %q", s)
}
