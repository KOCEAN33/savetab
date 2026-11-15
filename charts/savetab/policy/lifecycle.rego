# The lifecycle rules of the vault page practices/backend/service-lifecycle.md,
# section "Manifests in the repository", over the chart's rendered Deployment.
package main

import rego.v1

containers contains c if {
	input.kind == "Deployment"
	some c in input.spec.template.spec.containers
}

env_seconds(c, name) := s if {
	some e in c.env
	e.name == name
	s := time.parse_duration_ns(e.value) / 1e9
}

failure_threshold(probe) := object.get(probe, "failureThreshold", 3)

deny contains msg if {
	some c in containers
	some probe in ["livenessProbe", "startupProbe"]
	object.get(c, [probe, "httpGet", "path"], "") != "/livez"
	msg := sprintf("container %s: %s must get /livez", [c.name, probe])
}

deny contains msg if {
	some c in containers
	object.get(c, ["readinessProbe", "httpGet", "path"], "") != "/readyz"
	msg := sprintf("container %s: readinessProbe must get /readyz", [c.name])
}

deny contains msg if {
	some c in containers
	failure_threshold(c.livenessProbe) <= failure_threshold(c.readinessProbe)
	msg := sprintf("container %s: livenessProbe.failureThreshold must be higher than readinessProbe's", [c.name])
}

deny contains msg if {
	some c in containers
	not object.get(c.readinessProbe, "timeoutSeconds", 1) > env_seconds(c, "READY_PING_TIMEOUT")
	msg := sprintf("container %s: readinessProbe.timeoutSeconds must be greater than READY_PING_TIMEOUT", [c.name])
}

deny contains msg if {
	some c in containers
	not c.lifecycle.preStop.sleep.seconds
	msg := sprintf("container %s: needs a preStop sleep", [c.name])
}

deny contains msg if {
	some c in containers
	grace := object.get(input.spec.template.spec, "terminationGracePeriodSeconds", 30)
	not grace >= c.lifecycle.preStop.sleep.seconds + env_seconds(c, "SHUTDOWN_BUDGET")
	msg := sprintf("container %s: terminationGracePeriodSeconds must be at least the preStop sleep plus SHUTDOWN_BUDGET", [c.name])
}
