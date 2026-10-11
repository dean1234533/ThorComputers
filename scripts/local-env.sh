#!/usr/bin/env bash
# Runs a command in an isolated local-development environment:
#  * a working JDK on PATH (the Firestore/Storage emulators need Java 21+);
#  * no Google credentials, so nothing run from here can reach a real Firebase/GCP project even by accident.
# macOS ships a /usr/bin/java *stub* that fails when no JDK is installed, so test by executing it.
unset GOOGLE_APPLICATION_CREDENTIALS GOOGLE_CLOUD_PROJECT GCLOUD_PROJECT
if ! java -version >/dev/null 2>&1; then
  for d in "$HOME"/.local/jdk/*/Contents/Home /opt/homebrew/opt/openjdk*/libexec/openjdk.jdk/Contents/Home /Library/Java/JavaVirtualMachines/*/Contents/Home; do
    if [ -x "$d/bin/java" ]; then export JAVA_HOME="$d"; export PATH="$d/bin:$PATH"; break; fi
  done
fi
if ! java -version >/dev/null 2>&1; then
  echo "No working Java found. Install JDK 21+ (e.g. 'brew install openjdk@21' or download Temurin 21 into ~/.local/jdk) and retry." >&2
  exit 1
fi
# Swap HOME last so gcloud Application Default Credentials and any `firebase login` session are invisible to the emulators.
# The emulator jar cache is kept via a symlink so nothing is re-downloaded.
export REAL_HOME="$HOME"; LOCAL_HOME="$(mktemp -d)"; [ -d "$HOME/.cache" ] && ln -s "$HOME/.cache" "$LOCAL_HOME/.cache"
export HOME="$LOCAL_HOME" CLOUDSDK_CONFIG="$LOCAL_HOME/gcloud" XDG_CONFIG_HOME="$LOCAL_HOME/.config"
exec "$@"
