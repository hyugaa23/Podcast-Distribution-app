# Go API + worker + migrate binaries (PRD §65, §102).
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

FROM alpine:3.22
RUN apk add --no-cache ffmpeg ca-certificates tzdata wget font-dejavu && adduser -D -u 10001 app \
 && mkdir -p /data/media && chown app:app /data/media
COPY --from=build /out/ /usr/local/bin/
USER app
WORKDIR /home/app
EXPOSE 8080
CMD ["api"]
