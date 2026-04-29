#!/usr/bin/env bash
set -euo pipefail

echo "[1/10] PATH vorbereiten ..."
export PATH="$HOME/.local/bin:$HOME/go/bin:$HOME/.cargo/bin:$PATH"

mkdir -p "$HOME/.local/bin" "$HOME/.local/opt"

########################################
echo "[2/10] Python LSP (pyright + pylsp)"
########################################
npm install -g pyright
pipx install --force 'python-lsp-server[all]'

########################################
echo "[3/10] TypeScript / JavaScript LSP"
########################################
npm install -g typescript-language-server typescript

########################################
echo "[4/10] C# (OmniSharp)"
########################################
OMNI_VERSION=$(curl -s https://api.github.com/repos/OmniSharp/omnisharp-roslyn/releases/latest | jq -r .tag_name)
OMNI_DIR="$HOME/.local/opt/omnisharp"

rm -rf "$OMNI_DIR"
mkdir -p "$OMNI_DIR"

curl -L "https://github.com/OmniSharp/omnisharp-roslyn/releases/download/${OMNI_VERSION}/omnisharp-linux-x64-net6.0.tar.gz" \
  | tar -xz -C "$OMNI_DIR"

ln -sf "$OMNI_DIR/OmniSharp" "$HOME/.local/bin/omnisharp"

########################################
echo "[5/10] Java (jdtls STABLE FIX)"
########################################

JDTLS_DIR="$HOME/.local/opt/jdtls"
rm -rf "$JDTLS_DIR"
mkdir -p "$JDTLS_DIR"

# Feste Version (stabil!)
JDTLS_URL="http://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz"

echo "Downloading JDTLS..."
curl -L "$JDTLS_URL" -o /tmp/jdtls.tar.gz

# Check ob Datei wirklich tar.gz ist
file /tmp/jdtls.tar.gz

tar -xzf /tmp/jdtls.tar.gz -C "$JDTLS_DIR"

cat > "$HOME/.local/bin/jdtls" <<'JDTLS'
#!/usr/bin/env bash
JDTLS="$HOME/.local/opt/jdtls"

exec java \
  -Declipse.application=org.eclipse.jdt.ls.core.id1 \
  -Declipse.product=org.eclipse.jdt.ls.core.product \
  -Xmx1G \
  -jar "$JDTLS"/plugins/org.eclipse.equinox.launcher_*.jar \
  -configuration "$JDTLS"/config_linux \
  -data "$PWD/.jdtls-workspace"
JDTLS

chmod +x "$HOME/.local/bin/jdtls"

########################################
echo "[6/10] Go (gopls)"
########################################
go install golang.org/x/tools/gopls@latest

########################################
echo "[7/10] Rust (rust-analyzer)"
########################################
rustup component add rust-analyzer

########################################
echo "[8/10] C / C++ (clangd)"
########################################
# bereits über apt installiert
clangd --version || true

########################################
echo "[9/10] Ruby (solargraph)"
########################################
########################################
echo "[FIX] Ruby Solargraph"
########################################

gem install --user-install solargraph

RUBY_BIN="$(ruby -e 'print Gem.user_dir')/bin"

# PATH korrekt setzen
if ! grep -q "$RUBY_BIN" ~/.bashrc; then
  echo "export PATH=\"$RUBY_BIN:\$PATH\"" >> ~/.bashrc
fi

export PATH="$RUBY_BIN:$PATH"

# prüfen
if command -v solargraph >/dev/null 2>&1; then
  echo "✔ solargraph"
else
  echo "✘ solargraph fehlt"
fi


########################################
echo "[10/10] PHP (intelephense)"
########################################
npm install -g intelephense

########################################
echo "[FIX] Kotlin LSP (tar.gz robust)"
########################################

KOTLIN_DIR="$HOME/.local/opt/kotlin-lsp"
TMP_JSON="/tmp/kotlin-lsp-release.json"
TMP_TGZ="/tmp/kotlin-lsp.tar.gz"

rm -rf "$KOTLIN_DIR"
mkdir -p "$KOTLIN_DIR" "$HOME/.local/bin"

# Release-Info holen
curl -fsSL "https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest" -o "$TMP_JSON"

# Linux x64 Standalone tar.gz extrahieren:
# - kein VSIX
# - keine sha256
# - kein aarch64
URL="$(
  jq -r '.body' "$TMP_JSON" \
    | grep -Eo 'https://[^ )"]+\.tar\.gz' \
    | grep -v '\.sha256$' \
    | grep -v 'aarch64' \
    | head -n1
)"

if [ -z "${URL:-}" ]; then
  echo "❌ Kotlin-LSP tar.gz URL konnte nicht automatisch gefunden werden."
  echo "Gefundene Kandidaten:"
  jq -r '.body' "$TMP_JSON" | grep -Eo 'https://[^ )"]+' || true
  exit 1
fi

echo "Download: $URL"

# Download mit Timeout, damit nichts ewig hängt
curl -fL --connect-timeout 20 --max-time 300 "$URL" -o "$TMP_TGZ"

# Validieren
if ! file "$TMP_TGZ" | grep -qi 'gzip compressed data'; then
  echo "❌ Download ist kein tar.gz:"
  file "$TMP_TGZ"
  echo
  echo "Erste Zeilen:"
  head -n 20 "$TMP_TGZ" || true
  exit 1
fi

# Entpacken
tar -xzf "$TMP_TGZ" -C "$KOTLIN_DIR"

# Aktueller offizieller Standalone-Launcher heißt kotlin-lsp.sh.
# Laut Kotlin/kotlin-lsp wird der Standalone-Server über kotlin-lsp.sh gestartet.
BIN="$(
  find "$KOTLIN_DIR" -type f -name "kotlin-lsp.sh" | head -n1
)"

if [ -z "${BIN:-}" ]; then
  echo "❌ Kotlin-LSP Launcher kotlin-lsp.sh nicht gefunden."
  echo "Gefundene Kandidaten:"
  find "$KOTLIN_DIR" -maxdepth 4 -type f \( -name "*.sh" -o -name "*lsp*" -o -name "*server*" \) | sed -n '1,160p'
  exit 1
fi

chmod +x "$BIN"

# Alte kaputte Installation entfernen:
# Bei dir ist ~/.local/bin/kotlin-language-server ein Verzeichnis.
if [ -e "$HOME/.local/bin/kotlin-language-server" ] || [ -L "$HOME/.local/bin/kotlin-language-server" ]; then
  rm -rf "$HOME/.local/bin/kotlin-language-server"
fi

cat > "$HOME/.local/bin/kotlin-language-server" <<EOF
#!/usr/bin/env bash
exec "$BIN" "\$@"
EOF

chmod +x "$HOME/.local/bin/kotlin-language-server"

# Nur Existenz prüfen, NICHT starten
if command -v kotlin-language-server >/dev/null 2>&1; then
  echo "✔ kotlin-language-server -> $BIN"
else
  echo "✘ kotlin-language-server fehlt"
  exit 1
fi

########################################
echo "[FIX] Swift / SourceKit-LSP"
########################################

mkdir -p "$HOME/.local/bin" "$HOME/.local/share"

# 1) swiftly installieren, falls fehlt
if ! command -v swiftly >/dev/null 2>&1; then
  echo "swiftly fehlt -> installiere swiftly"

  TMP_SWIFTLY_DIR="$(mktemp -d)"
  cd "$TMP_SWIFTLY_DIR"

  SWIFTLY_ARCH="$(uname -m)"
  case "$SWIFTLY_ARCH" in
    x86_64)
      SWIFTLY_ARCH="x86_64"
      ;;
    aarch64|arm64)
      SWIFTLY_ARCH="aarch64"
      ;;
    *)
      echo "❌ Nicht unterstützte Architektur für swiftly: $(uname -m)"
      exit 1
      ;;
  esac

  # Offizieller Swift.org-Installer
  curl -fL "https://download.swift.org/swiftly/linux/swiftly-${SWIFTLY_ARCH}.tar.gz" \
    -o swiftly.tar.gz

  tar -xzf swiftly.tar.gz

  # init ist interaktiv-arm, --quiet-shell-followup verhindert nur Shell-Hinweise
  ./swiftly init --quiet-shell-followup

  cd "$OLDPWD"
  rm -rf "$TMP_SWIFTLY_DIR"
fi

# 2) Swiftly-Env laden
if [ -f "$HOME/.local/share/swiftly/env.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.local/share/swiftly/env.sh"
fi

if [ -f "$HOME/.swiftly/env.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.swiftly/env.sh"
fi

# 3) Falls swiftly jetzt im PATH ist: Toolchain installieren/aktivieren
if command -v swiftly >/dev/null 2>&1; then
  swiftly install --use latest || swiftly install latest || true
else
  echo "❌ swiftly ist nach Installation nicht im PATH."
  echo "Versuche neues Terminal oder: source ~/.bashrc"
  exit 1
fi

hash -r

# 4) sourcekit-lsp finden
SOURCEKIT_BIN="$(command -v sourcekit-lsp || true)"

if [ -z "$SOURCEKIT_BIN" ]; then
  SOURCEKIT_BIN="$(find "$HOME/.local/share/swiftly" "$HOME/.swiftly" -type f -name sourcekit-lsp 2>/dev/null | head -n1 || true)"
fi

if [ -z "$SOURCEKIT_BIN" ]; then
  echo "❌ sourcekit-lsp nicht gefunden."
  echo "Swift-Version:"
  swift --version || true
  echo
  echo "Swiftly-Toolchains:"
  swiftly list || true
  exit 1
fi

chmod +x "$SOURCEKIT_BIN"

# 5) stabilen Command in ~/.local/bin setzen
rm -f "$HOME/.local/bin/sourcekit-lsp"
ln -s "$SOURCEKIT_BIN" "$HOME/.local/bin/sourcekit-lsp"

echo "✔ sourcekit-lsp -> $SOURCEKIT_BIN"

echo
echo "Fertig. Installation prüfen:"
echo "----------------------------"

check() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "✔ $1"
  else
    echo "✘ $1 fehlt"
  fi
}

check pyright
check pyright-langserver
check pylsp
check typescript-language-server
check omnisharp
check jdtls
check gopls
check rust-analyzer
check clangd
check solargraph
check intelephense
check kotlin-language-server
check sourcekit-lsp

echo
echo "Kein Server wurde gestartet → kein Blocking mehr."

echo
echo "Wichtig: neues Terminal öffnen oder:"
echo "source ~/.bashrc"

