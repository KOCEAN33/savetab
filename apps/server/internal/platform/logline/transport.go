package logline

import (
	"net/http"
	"time"
)

// Transport returns a RoundTripper for calls to the dependency name. A call made inside a unit
// of work carries the unit's trace as traceparent and counts on the unit's line.
func Transport(base http.RoundTripper, name string) http.RoundTripper {
	return transport{base: base, name: name}
}

type transport struct {
	base http.RoundTripper
	name string
}

func (t transport) RoundTrip(r *http.Request) (*http.Response, error) {
	f := from(r.Context())
	if f == nil {
		return t.base.RoundTrip(r)
	}
	// A RoundTripper must not change the request it is given.
	r = r.Clone(r.Context())
	// 01 marks the trace as sampled, so a callee that records traces keeps this one.
	r.Header.Set("traceparent", "00-"+f.traceID+"-"+randomHex(8)+"-01")
	start := time.Now()
	resp, err := t.base.RoundTrip(r)
	f.addCall(t.name, time.Since(start))
	return resp, err
}
