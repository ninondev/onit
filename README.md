# Onit

Onit is a personal adviser that runs on your own machine. It keeps a private record of what you are working on, prepares material from sources you selected, reviews goals you chose to track, and generates small single-purpose apps from one sentence. One Go binary, one SQLite file, no account, no telemetry.

This repository contains the backend and the web client. The Android app is not included.

## What it does

- A daily voice: one short observation drawn from the material you keep, with three actions (keep, rewrite, drop).
- Goals with progress entries and a review that runs only after you enable it.
- Prepared briefs built from selected sources, with the exact quotes kept beside the result.
- Small apps generated from a sentence, stored as artifacts, and rerunnable with a new request.
- Discovery, dossier, proposal and weekly report views over the same local data.

Everything is stored in `memory.sqlite` inside the data directory. The server listens on loopback and requires a bearer token.

## Requirements

- Go 1.26 or newer.
- An OpenAI-compatible chat completions endpoint. The server accepts HTTPS endpoints, and HTTP only for localhost or private network addresses, without embedded credentials or query parameters. Background work calls the endpoint without an API key, so point it at a local model or a local proxy that holds your key.

## Quick start

Build the binary and create a data directory:

```bash
cd backend
go build -o ../adviser .
../adviser init -dir ../data
```

`init` writes the owner credential to `data/credentials/owner-a.token` and does not print it. Start the server with the web client:

```bash
../adviser serve -dir ../data -web ../web -endpoint http://127.0.0.1:11434/v1/chat/completions -model your-model
```

Open `http://127.0.0.1:7341/?live=1&t=<token>`, replacing `<token>` with the contents of the credential file. The client stores the token in local storage and removes it from later requests.

To load the synthetic demo set:

```bash
../adviser seed -dir ../data -base http://127.0.0.1:7341 -token-file ../data/credentials/owner-a.token
```

Without `?live=1` the web client shows built-in demo data and makes no requests. The interface is in Chinese.

## Layout

- `backend/`: the Go server, its tests and synthetic fixtures.
- `web/`: the static client (`index.html`, CSS, JavaScript, fonts).

## Commands

```
adviser serve|issue|android-bridge|app-job|init|doctor|seed|backup|restore|goal-review|goal-review-worker
```

Run a command with no arguments to see its flags.

- `init -dir <new dir>` creates a data directory, a manifest and one owner credential.
- `issue -db <file>` creates another owner token and prints it once, or writes it with `-token-file`.
- `serve -dir <dir> [-web <dir>] [-listen 127.0.0.1:7341] [-endpoint <url> -model <name>]` starts the API and, with `-web`, the client.
- `doctor -dir <dir>` checks a data directory.
- `backup -dir <dir> -out <new dir>` copies a data directory with a manifest and per-file digests. `restore` reads it back.

## API

Every route lives under `/v1/` and needs `Authorization: Bearer <token>`. Responses are JSON. The full route table is in `backend/service.go`. The web client uses these:

- `GET /v1/artifacts/{date}`
- `POST /v1/apps/make`
- `POST /v1/apps/update`
- `GET /v1/model`
- `POST /v1/voice-act`

## Privacy

The server binds to a numeric loopback address only. It writes no telemetry and makes no network request except to the model endpoint you configure. The data directory is created with mode 0700 and credentials with mode 0600. `backup` copies the directory as files, so store the copy somewhere you trust.

## Tests

```bash
cd backend
go test ./...
```

Some tests skip unless their environment variables are set: `ONIT_REAL_MODEL_ENDPOINT`, `ONIT_REAL_MODEL_NAME` and `ONIT_REAL_MODEL_KEY` for the real-model check, and `ONIT_LOCK_*` for the lock-window probe.

## License

MIT. See `LICENSE`. Third-party components and their licenses are listed in `THIRD-PARTY-NOTICES.md`.
