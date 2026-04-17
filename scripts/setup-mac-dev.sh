#!/usr/bin/env bash
# SQLSentinel — Mac dev environment setup
set -euo pipefail

echo "==> Checking prerequisites..."

if ! command -v brew &>/dev/null; then
  echo "ERROR: Homebrew not found. Install from https://brew.sh"
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "Installing Docker via Homebrew..."
  brew install --cask docker
  echo "  Docker installed. Open Docker.app once before continuing."
  open /Applications/Docker.app
  echo "  Press Enter when Docker Desktop is running..."
  read -r
fi

if ! command -v node &>/dev/null; then
  echo "Installing Node.js via Homebrew..."
  brew install node@22
  echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi

if ! command -v ollama &>/dev/null; then
  echo "Installing Ollama..."
  brew install ollama
fi

echo ""
echo "==> Starting SQL Server container..."
docker compose up -d

echo "  Waiting for SQL Server to be healthy..."
until docker compose exec sqlserver \
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'SQLSentinel@Dev1' -Q 'SELECT 1' -No &>/dev/null; do
  printf '.'
  sleep 3
done
echo " ready."

echo ""
echo "==> Pulling Ollama model (llama3.2:3b)..."
ollama serve &>/dev/null &
sleep 2
ollama pull llama3.2:3b

echo ""
echo "==> Installing npm dependencies..."
npm install

echo ""
echo "==> Done! To start SQLSentinel:"
echo "    npm run dev"
echo ""
echo "    SQL Server credentials:"
echo "      Host: localhost   Port: 1433"
echo "      Auth: SQL Auth    User: sa    Password: SQLSentinel@Dev1"
