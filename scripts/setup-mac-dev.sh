#!/usr/bin/env bash
# SQLSentinel — Mac dev environment setup
set -euo pipefail

WITH_OLLAMA=0

for arg in "$@"; do
  case "$arg" in
    --with-ollama)
      WITH_OLLAMA=1
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: $0 [--with-ollama]"
      exit 1
      ;;
  esac
done

require_brew_formula() {
  local formula="$1"

  if brew list --formula "$formula" &>/dev/null; then
    return 0
  fi

  echo "Installing $formula via Homebrew..."
  brew install "$formula"
}

ensure_node_22() {
  local current_major=""
  if command -v node &>/dev/null; then
    current_major="$(node -p "process.versions.node.split('.')[0]")"
  fi

  if [[ "$current_major" == "22" ]]; then
    return 0
  fi

  require_brew_formula node@22
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

  local installed_major
  installed_major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$installed_major" != "22" ]]; then
    echo "ERROR: Node.js v22 is required. Current shell resolves to: $(node -v)"
    echo 'Add /opt/homebrew/opt/node@22/bin to PATH, then rerun this script.'
    exit 1
  fi
}

ensure_docker_running() {
  if docker info &>/dev/null; then
    return 0
  fi

  echo "Starting Docker Desktop..."
  open /Applications/Docker.app
  echo "Waiting for Docker daemon..."

  until docker info &>/dev/null; do
    printf '.'
    sleep 3
  done

  echo " ready."
}
echo "==> Checking prerequisites..."

if ! command -v brew &>/dev/null; then
  echo "ERROR: Homebrew not found. Install from https://brew.sh"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "Installing Docker via Homebrew..."
  brew install --cask docker
fi

ensure_docker_running
ensure_node_22

if [[ "$WITH_OLLAMA" == "1" ]] && ! command -v ollama &>/dev/null; then
  echo "Installing Ollama..."
  require_brew_formula ollama
fi

echo ""
echo "==> Starting test environment (4 monitored servers + 1 storage server)..."
docker compose -f docker/docker-compose.yml up -d

echo "  Waiting for SQL Server 2025 (storage) to be healthy..."
until docker compose -f docker/docker-compose.yml exec sql-sentinel \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'Sentinel@SQLSentinel1' -Q 'SELECT 1' -b -C &>/dev/null; do
  printf '.'
  sleep 3
done
echo " ready."

echo "  Waiting for sql-init to finish schema setup..."
until [[ "$(docker compose -f docker/docker-compose.yml ps sql-init --format '{{.Status}}' 2>/dev/null)" == *"Exited (0)"* ]]; do
  printf '.'
  sleep 3
done
echo " done."

if [[ "$WITH_OLLAMA" == "1" ]]; then
  echo ""
  echo "==> Pulling Ollama model (llama3.2:3b)..."
  ollama serve &>/dev/null &
  sleep 2
  ollama pull llama3.2:3b
else
  echo ""
  echo "==> Skipping Ollama bootstrap."
  echo "    Run '$0 --with-ollama' later if you want local AI features."
fi

echo ""
echo "==> Installing npm dependencies..."
npm install

echo ""
echo "==> Done! To start SQLSentinel:"
echo "    npm run dev"
echo ""
echo "    Storage database (SQL Server 2025):"
echo "      Host: localhost   Port: 1437"
echo "      App user:  sqlsentinel_app / App@Sentinel2025"
echo "      SA:        sa              / Sentinel@SQLSentinel1"
echo ""
echo "    Monitored test servers (Azure SQL Edge):"
echo "      prod-sql     localhost:1433"
echo "      dev-sql      localhost:1434"
echo "      staging-sql  localhost:1435"
echo "      dr-sql       localhost:1436"
if [[ "$WITH_OLLAMA" == "1" ]]; then
  echo ""
  echo "    Ollama model: llama3.2:3b"
fi
