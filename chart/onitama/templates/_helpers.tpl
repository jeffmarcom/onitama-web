{{/*
Fullname: release-name truncated to 63 chars.
*/}}
{{- define "onitama.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "onitama.labels" -}}
app.kubernetes.io/name: onitama
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Selector labels for the app deployment.
*/}}
{{- define "onitama.selectorLabels" -}}
app.kubernetes.io/name: onitama
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
