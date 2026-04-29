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
echo "[5/10] Java (jdtls)"
########################################
JDTLS_DIR="$HOME/.local/opt/jdtls"
rm -rf "$JDTLS_DIR"
mkdir -p "$JDTLS_DIR"

curl -L https://download.eclipse.org/jdtls/milestones/latest/jdt-language-server-latest.tar.gz \
  -o /tmp/jdtls.tar.gz

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
gem install --user-install solargraph

########################################
echo "[10/10] PHP (intelephense)"
########################################
npm install -g intelephense

########################################
echo "[extra] Kotlin LSP"
########################################
KOTLIN_DIR="$HOME/.local/opt/kotlin-language-server"
rm -rf "$KOTLIN_DIR"
mkdir -p "$KOTLIN_DIR"

curl -L https://github.com/fwcd/kotlin-language-server/releases/latest/download/server.zip \
  -o /tmp/kotlin-ls.zip

unzip -q /tmp/kotlin-ls.zip -d "$KOTLIN_DIR"

KLS_BIN=$(find "$KOTLIN_DIR" -name kotlin-language-server | head -n1)
ln -sf "$KLS_BIN" "$HOME/.local/bin/kotlin-language-server"

########################################
echo "[extra] Swift (sourcekit-lsp)"
########################################
# kommt mit Swift Toolchain
sourcekit-lsp --version || true

########################################
echo
echo "Fertig. Versionen prüfen:"
echo "------------------------"

pyright --version || true
pylsp --version || true
typescript-language-server --version || true
omnisharp --version || true
jdtls --help || true
gopls version || true
rust-analyzer --version || true
clangd --version || true
solargraph --version || true
intelephense --version || true
kotlin-language-server --version || true
sourcekit-lsp --version || true

echo
echo "Wichtig: neues Terminal öffnen oder:"
echo "source ~/.bashrc"

