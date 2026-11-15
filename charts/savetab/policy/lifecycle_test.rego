package main

import rego.v1

good := {
	"kind": "Deployment",
	"spec": {"template": {"spec": {
		"terminationGracePeriodSeconds": 25,
		"containers": [{
			"name": "server",
			"env": [{"name": "READY_PING_TIMEOUT", "value": "1s"}, {"name": "SHUTDOWN_BUDGET", "value": "20s"}],
			"startupProbe": {"httpGet": {"path": "/livez"}},
			"livenessProbe": {"httpGet": {"path": "/livez"}, "failureThreshold": 6},
			"readinessProbe": {"httpGet": {"path": "/readyz"}, "timeoutSeconds": 2, "failureThreshold": 3},
			"lifecycle": {"preStop": {"sleep": {"seconds": 5}}},
		}],
	}}},
}

with_container(patch) := json.patch(good, [{"op": "add", "path": sprintf("/spec/template/spec/containers/0/%s", [k]), "value": v} | some k, v in patch])

test_good_passes if {
	count(deny) == 0 with input as good
}

test_liveness_on_readyz_fails if {
	count(deny) > 0 with input as with_container({"livenessProbe": {"httpGet": {"path": "/readyz"}, "failureThreshold": 6}})
}

test_readiness_on_healthz_fails if {
	count(deny) > 0 with input as with_container({"readinessProbe": {"httpGet": {"path": "/healthz"}, "timeoutSeconds": 2}})
}

test_liveness_threshold_not_above_readiness_fails if {
	count(deny) > 0 with input as with_container({"livenessProbe": {"httpGet": {"path": "/livez"}, "failureThreshold": 3}})
}

test_readiness_timeout_not_above_ping_timeout_fails if {
	count(deny) > 0 with input as with_container({"readinessProbe": {"httpGet": {"path": "/readyz"}, "timeoutSeconds": 1, "failureThreshold": 3}})
}

test_no_prestop_sleep_fails if {
	count(deny) > 0 with input as with_container({"lifecycle": {}})
}

test_short_grace_period_fails if {
	count(deny) > 0 with input as json.patch(good, [{"op": "replace", "path": "/spec/template/spec/terminationGracePeriodSeconds", "value": 24}])
}
