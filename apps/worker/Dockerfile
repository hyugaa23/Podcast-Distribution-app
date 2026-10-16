# Background worker (PRD §72, §73). Built from the shared Go module in apps/api (cmd/worker)
# so business logic lives in one place. Build from the repo root:
#   docker build -f apps/worker/Dockerfile .
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker

FROM alpine:3.22
RUN apk add --no-cache ffmpeg ca-certificates tzdata && adduser -D -u 10001 app
COPY --from=build /out/worker /usr/local/bin/worker
USER app
CMD ["worker"]
