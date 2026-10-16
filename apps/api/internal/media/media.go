// Package media wraps FFmpeg/FFprobe for the audio pipeline (PRD §14) and
// image variant generation (PRD §76).
package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type Tool struct {
	FFmpeg  string
	FFprobe string
}

type AudioInfo struct {
	FormatName string  `json:"format_name"`
	Codec      string  `json:"codec"`
	Duration   float64 `json:"duration"`
	Bitrate    int     `json:"bitrate"`
	SampleRate int     `json:"sample_rate"`
	Channels   int     `json:"channels"`
}

type ImageInfo struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Codec  string `json:"codec"`
}

// UserError is an error with a user-friendly reason and technical detail (PRD §80).
type UserError struct {
	Reason string
	Detail string
}

func (e *UserError) Error() string { return e.Reason + ": " + e.Detail }

func userErr(reason, detail string) error { return &UserError{Reason: reason, Detail: detail} }

// FriendlyReason extracts the user-facing reason from err.
func FriendlyReason(err error) (string, string) {
	var ue *UserError
	if errors.As(err, &ue) {
		return ue.Reason, ue.Detail
	}
	return "Unexpected processing error.", err.Error()
}

type probeOut struct {
	Streams []struct {
		CodecType  string `json:"codec_type"`
		CodecName  string `json:"codec_name"`
		SampleRate string `json:"sample_rate"`
		Channels   int    `json:"channels"`
		BitRate    string `json:"bit_rate"`
		Width      int    `json:"width"`
		Height     int    `json:"height"`
		Duration   string `json:"duration"`
	} `json:"streams"`
	Format struct {
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
		BitRate    string `json:"bit_rate"`
	} `json:"format"`
}

func (t Tool) probe(ctx context.Context, path string) (*probeOut, error) {
	cmd := exec.CommandContext(ctx, t.FFprobe, "-v", "error", "-protocol_whitelist", "file,pipe",
		"-print_format", "json", "-show_format", "-show_streams", path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return nil, userErr("Audio processor is not available.", "ffprobe not found: "+err.Error())
		}
		return nil, userErr("File could not be read. It may be corrupted or in an unsupported format.",
			strings.TrimSpace(stderr.String()+" "+err.Error()))
	}
	var p probeOut
	if err := json.Unmarshal(out, &p); err != nil {
		return nil, userErr("File could not be analysed.", err.Error())
	}
	return &p, nil
}

var supportedAudioCodecs = map[string]bool{
	"mp3": true, "aac": true, "alac": true, "pcm_s16le": true, "pcm_s24le": true, "pcm_s32le": true,
	"pcm_f32le": true, "pcm_u8": true, "pcm_s16be": true, "flac": true, "opus": true, "vorbis": true,
}

// ProbeAudio validates that path is a supported audio file and returns its metadata.
func (t Tool) ProbeAudio(ctx context.Context, path string) (*AudioInfo, error) {
	p, err := t.probe(ctx, path)
	if err != nil {
		return nil, err
	}
	info := &AudioInfo{FormatName: p.Format.FormatName}
	found := false
	for _, s := range p.Streams {
		if s.CodecType != "audio" {
			continue
		}
		found = true
		info.Codec = s.CodecName
		info.SampleRate, _ = strconv.Atoi(s.SampleRate)
		info.Channels = s.Channels
		info.Bitrate, _ = strconv.Atoi(s.BitRate)
		if d, err := strconv.ParseFloat(s.Duration, 64); err == nil {
			info.Duration = d
		}
		break
	}
	if !found {
		return nil, userErr("No audio stream found in file.", "ffprobe reported no audio stream")
	}
	if !supportedAudioCodecs[info.Codec] {
		return nil, userErr("Unsupported codec.", "codec="+info.Codec)
	}
	if d, err := strconv.ParseFloat(p.Format.Duration, 64); err == nil && d > 0 {
		info.Duration = d
	}
	if info.Bitrate == 0 {
		info.Bitrate, _ = strconv.Atoi(p.Format.BitRate)
	}
	if info.Duration <= 0 {
		return nil, userErr("Audio duration could not be determined.", "duration=0")
	}
	return info, nil
}

// TranscodeMP3 normalizes loudness and encodes a streaming MP3 (PRD §14: MP3 128–192 kbps).
func (t Tool) TranscodeMP3(ctx context.Context, in, out string, kbps int, normalize bool) error {
	if kbps < 128 {
		kbps = 128
	}
	if kbps > 192 {
		kbps = 192
	}
	args := []string{"-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file,pipe", "-i", in, "-vn", "-map_metadata", "-1"}
	if normalize {
		args = append(args, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11")
	}
	args = append(args, "-ar", "44100", "-c:a", "libmp3lame", "-b:a", fmt.Sprintf("%dk", kbps), out)
	cmd := exec.CommandContext(ctx, t.FFmpeg, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return userErr("Audio could not be converted for streaming.", strings.TrimSpace(stderr.String()+" "+err.Error()))
	}
	return nil
}

// ProbeImage returns the dimensions of an image file.
func (t Tool) ProbeImage(ctx context.Context, path string) (*ImageInfo, error) {
	p, err := t.probe(ctx, path)
	if err != nil {
		return nil, err
	}
	for _, s := range p.Streams {
		if s.CodecType == "video" && s.Width > 0 {
			return &ImageInfo{Width: s.Width, Height: s.Height, Codec: s.CodecName}, nil
		}
	}
	return nil, userErr("File is not a valid image.", "no image stream")
}

// Variant sizes (PRD §76: Thumbnail, Small, Medium, Large, Original).
var ImageVariants = []struct {
	Name string
	Size int
}{{"thumbnail", 150}, {"small", 300}, {"medium", 600}, {"large", 1400}}

// ResizeWebP produces a WebP variant bounded by size x size.
func (t Tool) ResizeWebP(ctx context.Context, in, out string, size int) error {
	vf := fmt.Sprintf("scale='min(%d,iw)':'min(%d,ih)':force_original_aspect_ratio=decrease", size, size)
	cmd := exec.CommandContext(ctx, t.FFmpeg, "-hide_banner", "-loglevel", "error", "-y",
		"-protocol_whitelist", "file,pipe", "-i", in,
		"-vf", vf, "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", out)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return userErr("Image could not be resized.", strings.TrimSpace(stderr.String()+" "+err.Error()))
	}
	return nil
}

// ToJPEG converts any decodable image to JPEG (used for RSS artwork compatibility).
func (t Tool) ToJPEG(ctx context.Context, in, out string, maxSize int) error {
	vf := fmt.Sprintf("scale='min(%d,iw)':'min(%d,ih)':force_original_aspect_ratio=decrease", maxSize, maxSize)
	cmd := exec.CommandContext(ctx, t.FFmpeg, "-hide_banner", "-loglevel", "error", "-y",
		"-protocol_whitelist", "file,pipe", "-i", in,
		"-vf", vf, "-frames:v", "1", "-q:v", "3", out)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return userErr("Image could not be converted.", strings.TrimSpace(stderr.String()+" "+err.Error()))
	}
	return nil
}

// SecondsRounded returns duration rounded to whole seconds.
func SecondsRounded(d float64) int { return int(math.Round(d)) }

// ExtFor returns the extension for a filename lowercased without dot.
func ExtFor(name string) string {
	return strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
}
