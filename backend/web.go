package main

import (
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// withWeb serves the single-page client from dir at the root while /v1/ stays
// the API. Only GET and HEAD are served, directories are never listed, and an
// unknown path is a plain 404.
func withWeb(api http.Handler, dir string) (http.Handler, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return nil, fmt.Errorf("web directory: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("web path is not a directory: %s", dir)
	}
	root, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	prefix := root + string(os.PathSeparator)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		clean := path.Clean("/" + r.URL.Path)
		if clean == "/" {
			clean = "/index.html"
		}
		file := filepath.Join(root, filepath.FromSlash(clean))
		if !strings.HasPrefix(file, prefix) {
			http.NotFound(w, r)
			return
		}
		stat, err := os.Stat(file)
		if err != nil || stat.IsDir() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeFile(w, r, file)
	}), nil
}
