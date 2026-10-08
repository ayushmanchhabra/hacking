FROM ollama/ollama:latest
COPY ai/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
