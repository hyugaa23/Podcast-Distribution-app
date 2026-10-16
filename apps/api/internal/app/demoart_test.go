package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"podcast/api/internal/config"
)

// Renders sample covers when DEMO_ART_OUT is set (visual check of the demo cover generator).
func TestRenderCoverSamples(t *testing.T) {
	out := os.Getenv("DEMO_ART_OUT")
	if out == "" {
		t.Skip("set DEMO_ART_OUT to render samples")
	}
	a := &App{Cfg: &config.Config{FFmpegPath: "ffmpeg"}}
	specs := []coverSpec{
		{Title: "My Business Podcast", Kicker: "Business podcast", Byline: "with Sarah Mitchell", C0: "0x1457FF", C1: "0x0B1F4D"},
		{Title: "Creative Hours with Mia", Kicker: "Arts podcast", Byline: "with Mia Torres", C0: "0xF97316", C1: "0xFB7185"},
		{Title: "The Morning Report", Kicker: "News podcast", Byline: "with Anna Lopez", C0: "0xB91C1C", C1: "0x111111"},
		{Title: "Night Owls Comedy", Kicker: "Comedy podcast", Byline: "with Jake & Riley", C0: "0x1ED6A0", C1: "0x7C5CFF"},
	}
	for i, s := range specs {
		s.Style = i
		s.Size = 700
		dir := t.TempDir()
		if err := a.renderCover(context.Background(), dir, filepath.Join(out, "cover-"+string(rune('a'+i))+".jpg"), s); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.renderAvatar(context.Background(), t.TempDir(), filepath.Join(out, "avatar.jpg"), "Sarah Mitchell", "0x0B1F4D", "0x1457FF"); err != nil {
		t.Fatal(err)
	}
}
