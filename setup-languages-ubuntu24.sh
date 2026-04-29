#!/usr/bin/env bash
set -euo pipefail

echo "[1/9] Prüfe Ubuntu-Version ..."
if ! grep -q '^VERSION_ID="24.04"$' /etc/os-release; then
  echo "Dieses Skript ist für Ubuntu 24.04 gedacht."
  echo "Gefunden:"
  cat /etc/os-release
  exit 1
fi

echo "[2/9] Systempakete installieren ..."
sudo apt update

sudo apt install -y \
  ca-certificates \
  curl \
  wget \
  gnupg \
  jq \
  unzip \
  zip \
  tar \
  git \
  software-properties-common \
  build-essential \
  pkg-config \
  libssl-dev \
  zlib1g-dev \
  libsqlite3-dev \
  libncurses-dev \
  libreadline-dev \
  libxml2-dev \
  libcurl4-openssl-dev \
  python3 \
  python3-pip \
  python3-venv \
  pipx \
  nodejs \
  npm \
  openjdk-21-jdk \
  maven \
  gradle \
  dotnet-sdk-8.0 \
  golang-go \
  ruby-full \
  php-cli \
  php-mbstring \
  php-xml \
  php-curl \
  php-zip \
  clang \
  clangd \
  gdb \
  lldb

echo "[3/9] PATH vorbereiten ..."
mkdir -p "$HOME/.local/bin" "$HOME/.local/opt" "$HOME/go/bin"

add_path_line='export PATH="$HOME/.local/bin:$HOME/go/bin:$HOME/.cargo/bin:$PATH"'
if ! grep -qxF "$add_path_line" "$HOME/.bashrc"; then
  echo "$add_path_line" >> "$HOME/.bashrc"
fi

export PATH="$HOME/.local/bin:$HOME/go/bin:$HOME/.cargo/bin:$PATH"

echo "[4/9] npm global ohne sudo konfigurieren ..."
npm config set prefix "$HOME/.local"

echo "[5/9] TypeScript installieren ..."
npm install -g typescript

echo "[6/9] pipx aktivieren ..."
python3 -m pipx ensurepath

echo "[7/9] Rust installieren ..."
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile default
fi

# shellcheck disable=SC1091
source "$HOME/.cargo/env"

rustup update stable
rustup default stable
rustup component add rust-src rustfmt clippy

echo "[8/9] Kotlin über SDKMAN installieren ..."
if [ ! -s "$HOME/.sdkman/bin/sdkman-init.sh" ]; then
  curl -s "https://get.sdkman.io" | bash
fi

# shellcheck disable=SC1091
source "$HOME/.sdkman/bin/sdkman-init.sh"

if ! command -v kotlinc >/dev/null 2>&1; then
  sdk install kotlin
else
  sdk upgrade kotlin || true
fi

echo "[9/9] Swift über swiftly installieren ..."
SWIFTLY_VERSION="1.1.1"
SWIFTLY_ARCH="$(uname -m)"
SWIFTLY_TGZ="swiftly-${SWIFTLY_VERSION}-${SWIFTLY_ARCH}.tar.gz"

if ! command -v swiftly >/dev/null 2>&1; then
  tmpdir="$(mktemp -d)"
  cd "$tmpdir"

  curl -fLO "https://download.swift.org/swiftly/linux/${SWIFTLY_TGZ}"
  tar -zxf "$SWIFTLY_TGZ"

  ./swiftly init --verbose --assume-yes

  cd "$HOME"
  rm -rf "$tmpdir"
fi

# Swiftly-Env laden, falls vorhanden.
if [ -f "$HOME/.local/share/swiftly/env.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.local/share/swiftly/env.sh"
fi

if [ -f "$HOME/.swiftly/env.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.swiftly/env.sh"
fi

echo
echo "Installation abgeschlossen."
echo
echo "Versionen:"
echo "----------"
python3 --version || true
node --version || true
npm --version || true
tsc --version || true
dotnet --version || true
java -version || true
go version || true
rustc --version || true
cargo --version || true
gcc --version | head -n1 || true
clang --version | head -n1 || true
ruby --version || true
php --version | head -n1 || true
kotlinc -version || true
swift --version || true

echo
echo "Wichtig: Öffne danach ein neues Terminal oder führe aus:"
echo "source ~/.bashrc"
