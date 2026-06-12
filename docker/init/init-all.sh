#!/usr/bin/env bash
set -euo pipefail

SQLCMD=/opt/mssql-tools18/bin/sqlcmd

run_sql() {
  "$SQLCMD" -b -C "$@"
}

retry_sql() {
  local label=$1
  shift
  local attempt=1
  local max_attempts=24
  until run_sql "$@"; do
    if [[ $attempt -ge $max_attempts ]]; then
      echo "ERROR: $label failed after $max_attempts attempts"
      return 1
    fi
    echo "Waiting for $label ($attempt/$max_attempts)..."
    attempt=$((attempt + 1))
    sleep 5
  done
}

echo "→ Initializing sql-prod..."
run_sql -S sql-prod,1433 -U sa -P "$SQLSENTINEL_PROD_SA_PASSWORD" \
  -v DockUser="$SQLSENTINEL_DOCK_USER" DockPassword="$SQLSENTINEL_DOCK_PASSWORD" \
  -i /init/prod.sql

echo "→ Initializing sql-dev..."
run_sql -S sql-dev,1433 -U sa -P "$SQLSENTINEL_DEV_SA_PASSWORD" \
  -v DockUser="$SQLSENTINEL_DOCK_USER" DockPassword="$SQLSENTINEL_DOCK_PASSWORD" \
  -i /init/dev.sql

echo "→ Preparing nodo1..."
run_sql -S nodo1,1433 -U sa -P "$SQLSENTINEL_NODO1_SA_PASSWORD" \
  -v DockUser="$SQLSENTINEL_DOCK_USER" DockPassword="$SQLSENTINEL_DOCK_PASSWORD" \
     NodeName="nodo1" AgCertPassword="$SQLSENTINEL_AG_CERT_PASSWORD" \
     AgEndpointPassword="$SQLSENTINEL_AG_ENDPOINT_PASSWORD" \
  -i /init/nodo-common.sql

echo "→ Preparing nodo2..."
run_sql -S nodo2,1433 -U sa -P "$SQLSENTINEL_NODO2_SA_PASSWORD" \
  -v DockUser="$SQLSENTINEL_DOCK_USER" DockPassword="$SQLSENTINEL_DOCK_PASSWORD" \
     NodeName="nodo2" AgCertPassword="$SQLSENTINEL_AG_CERT_PASSWORD" \
     AgEndpointPassword="$SQLSENTINEL_AG_ENDPOINT_PASSWORD" \
  -i /init/nodo-common.sql

echo "→ Trusting AG endpoint certificates..."
run_sql -S nodo1,1433 -U sa -P "$SQLSENTINEL_NODO1_SA_PASSWORD" \
  -v RemoteNodeName="nodo2" -i /init/aon-trust-remote.sql
run_sql -S nodo2,1433 -U sa -P "$SQLSENTINEL_NODO2_SA_PASSWORD" \
  -v RemoteNodeName="nodo1" -i /init/aon-trust-remote.sql

echo "→ Creating SQLSentinelAON on nodo1..."
run_sql -S nodo1,1433 -U sa -P "$SQLSENTINEL_NODO1_SA_PASSWORD" \
  -i /init/aon-primary.sql

echo "→ Joining nodo2 to SQLSentinelAON..."
retry_sql "nodo2 AG join" -S nodo2,1433 -U sa -P "$SQLSENTINEL_NODO2_SA_PASSWORD" \
  -i /init/aon-secondary.sql

echo "→ Initializing sql-sentinel..."
run_sql -S sql-sentinel,1433 -U sa -P "$SQLSENTINEL_STORAGE_SA_PASSWORD" \
  -v DockUser="$SQLSENTINEL_DOCK_USER" DockPassword="$SQLSENTINEL_DOCK_PASSWORD" \
     AppUser="$SQLSENTINEL_APP_USER" AppPassword="$SQLSENTINEL_APP_PASSWORD" \
     MonitorUser="$SQLSENTINEL_MONITOR_USER" MonitorPassword="$SQLSENTINEL_MONITOR_PASSWORD" \
  -i /init/sentinel.sql

echo "✓ All databases initialized."
