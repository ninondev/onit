# Contributing

Issues and pull requests are welcome.

- Run `go test ./...` in `backend/` before sending a change.
- Keep the server loopback-only and keep credentials out of logs, argv and error messages.
- Match the existing code style. Comments in this codebase are in Chinese; that is fine.
- For a change to the API, update the route table in `backend/service.go` and any client code in `web/`.
- Do not add telemetry, analytics or a network call that is not the configured model endpoint.
