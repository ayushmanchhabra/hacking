#!/bin/sh
# Starts Ollama and pulls $OLLAMA_MODEL into the volume on first boot.
# The container reports healthy (see devops/docker-compose.yml) once the model is present.
set -e

ollama serve &
SERVER_PID=$!

until ollama list >/dev/null 2>&1; do sleep 1; done

if ! ollama show "$OLLAMA_MODEL" >/dev/null 2>&1; then
  echo "Pulling $OLLAMA_MODEL..."
  ollama pull "$OLLAMA_MODEL"
fi
echo "$OLLAMA_MODEL ready"

wait "$SERVER_PID"
