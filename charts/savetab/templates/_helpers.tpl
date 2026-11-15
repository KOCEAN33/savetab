{{- define "savetab.selector" -}}
app.kubernetes.io/name: savetab
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "savetab.podSecurity" -}}
securityContext:
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
{{- if .Values.imagePullSecret.enabled }}
imagePullSecrets:
  - name: ghcr-pull
{{- end }}
{{- end }}

{{- define "savetab.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
{{- end }}
