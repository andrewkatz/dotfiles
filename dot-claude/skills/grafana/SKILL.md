---
name: grafana
description: Query a Grafana instance configured via GRAFANA_URL and GRAFANA_TOKEN — pull metrics, list and inspect dashboards/panels, fetch alert state, or render panel snapshots. Use whenever the user asks about live metrics, dashboard contents, or alert status.
---

# Grafana

Use this skill any time the task needs live data from a Grafana instance — metric values, dashboard/panel definitions, alert state, or a rendered panel image. Prefer it over guessing at metric names or asking the user to paste numbers.

## Setup

Auth uses a **Grafana service account token** stored in local shell secrets, not committed to this repo.

Add values to the private sops secrets repo and regenerate `~/.zsh_secrets` with `bin/ss`:

```yaml
common:
  GRAFANA_URL: "https://grafana.example.com"
  GRAFANA_TOKEN: "glsa_..."
```

If `GRAFANA_URL` or `GRAFANA_TOKEN` is unset when this skill runs, stop and tell the user to update sops secrets and run `bin/ss`. Do not prompt for the token in chat.

## Calling convention

Every request uses `curl` with bearer auth. Use `--silent --show-error --fail-with-body` so failures surface clearly, and pipe through `jq` for structured output.

```sh
curl -sS --fail-with-body \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/<endpoint>" | jq .
```

For POST: add `-H 'Content-Type: application/json' --data @- <<'JSON' ... JSON`.

Times: Grafana accepts **epoch milliseconds** (`$(date +%s)000`) or relative strings (`now`, `now-1h`, `now-7d`). Prometheus' raw API wants **epoch seconds**. Don't mix them up.

## Discover what's there

```sh
# List dashboards (optionally filter by query string)
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/search?type=dash-db&query=<QUERY>" \
  | jq '.[] | {uid, title, folderTitle}'

# Pull a dashboard's full definition (panels, queries, datasource refs)
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/dashboards/uid/<UID>" \
  | jq '.dashboard.panels[] | {id, title, datasource, targets}'

# List datasources — note the uid/type/id for each; uid is preferred for /api/ds/query
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/datasources" | jq '.[] | {id, uid, name, type}'
```

## Query metrics — unified API (preferred)

`POST /api/ds/query` accepts a batch of queries against any datasource by UID. Use this when you already know the datasource UID and want one consistent path.

```sh
NOW=$(date +%s)000
HOUR_AGO=$(( NOW - 3600000 ))

curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" \
  -H 'Content-Type: application/json' \
  "$GRAFANA_URL/api/ds/query" --data @- <<JSON | jq '.results'
{
  "from": "${HOUR_AGO}",
  "to":   "${NOW}",
  "queries": [
    {
      "refId": "A",
      "datasource": { "uid": "<DATASOURCE_UID>" },
      "maxDataPoints": 100,
      "intervalMs": 60000,
      "<datasource-specific fields below>": "..."
    }
  ]
}
JSON
```

Datasource-specific query fields inside each entry of `queries`:

- **Prometheus**: `"expr": "rate(http_requests_total[5m])"`, `"range": true`, `"instant": false`
- **Graphite**: `"target": "stats.timers.example.mean_90"`
- **CloudWatch**: `"namespace": "AWS/ApplicationELB"`, `"metricName": "RequestCount"`, `"dimensions": {"LoadBalancer": "..."}`, `"statistic": "Sum"`, `"region": "us-east-1"`

## Query metrics — datasource-proxied (fallback)

Sometimes it is simpler to use the datasource's native API via Grafana's proxy. Requires the numeric datasource `id` from `/api/datasources`.

```sh
# Graphite — /render returns JSON datapoints
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" -G \
  --data-urlencode "target=<GRAPHITE_TARGET>" \
  --data-urlencode "from=-1h" --data-urlencode "until=now" \
  --data-urlencode "format=json" \
  "$GRAFANA_URL/api/datasources/proxy/<ID>/render" | jq '.[0].datapoints[-5:]'

# Prometheus — instant
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" -G \
  --data-urlencode 'query=rate(http_requests_total[5m])' \
  "$GRAFANA_URL/api/datasources/proxy/<ID>/api/v1/query" | jq '.data.result'

# Prometheus — range (epoch SECONDS, not ms)
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" -G \
  --data-urlencode 'query=rate(http_requests_total[5m])' \
  --data-urlencode "start=$(date -v-1H +%s)" \
  --data-urlencode "end=$(date +%s)" \
  --data-urlencode "step=60" \
  "$GRAFANA_URL/api/datasources/proxy/<ID>/api/v1/query_range" | jq '.data.result'
```

CloudWatch does not have a useful proxy GET surface — use `/api/ds/query`.

## Alerts

```sh
# Currently firing / pending — Grafana-managed (Alertmanager v2 API)
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/alertmanager/grafana/api/v2/alerts" \
  | jq '.[] | {labels, state: .status.state, startsAt}'

# Rule definitions
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/v1/provisioning/alert-rules" | jq '.[] | {uid, title, folderUID}'

# Legacy unified alert state (works if classic alerting is enabled)
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" \
  "$GRAFANA_URL/api/alerts?state=alerting" | jq .
```

## Render a panel as PNG

Requires the `grafana-image-renderer` plugin on the server. If the response is HTML or 500s, the plugin is not installed — fall back to scraping the dashboard JSON and describing the panel instead.

```sh
curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" \
  -o /tmp/panel.png \
  "$GRAFANA_URL/render/d-solo/<DASHBOARD_UID>/_?panelId=<PANEL_ID>&from=now-1h&to=now&width=1000&height=500&tz=UTC"
```

Then read `/tmp/panel.png` to view it.

## Guidelines

- Start by discovering dashboards/datasources unless the user gives exact UIDs or query targets.
- Always narrow time windows (`now-1h`, not `now-30d`) — wide queries return huge payloads that blow context.
- Pipe through `jq` with a specific selector; don't dump raw responses.
- If a query 401s, the token is wrong/expired — tell the user; don't retry.
- If a query 403s, the service account lacks the needed role on that folder/datasource.
- Don't write to Grafana (create/update dashboards, silence alerts) without explicit user confirmation in chat, even if the token has Editor/Admin.
