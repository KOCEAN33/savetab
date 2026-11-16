package api

import (
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"strings"
)

var (
	//go:embed viewer/share.html
	viewerHTML string
	//go:embed viewer/share.js
	viewerJS string
	//go:embed viewer/share.css
	viewerCSS string
)

// viewerPage is the share viewer, the same bytes for every share, with its style and script
// inline. The viewer decrypts in the browser with the key from the URL fragment, which never
// reaches the server. viewerCSP keeps any script but that one off the page that holds the key.
var (
	viewerPage = strings.NewReplacer("/*style*/", viewerCSS, "/*script*/", viewerJS).Replace(viewerHTML)
	viewerCSP  = "default-src 'none'; script-src " + hashSource(viewerJS) + "; style-src " + hashSource(viewerCSS) +
		"; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)

// hashSource is the CSP source that admits the inline element whose text is content.
func hashSource(content string) string {
	sum := sha256.Sum256([]byte(content))
	return "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
}
