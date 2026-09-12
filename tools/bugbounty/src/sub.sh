#!/bin/bash

if [ -z "$2" ]; then
  echo "Usage: $0 <domain> <output.txt>" >&2
  exit 1
fi

if [[ "$2" != *.txt ]]; then
  echo "Error: output file must have a .txt extension" >&2
  exit 1
fi

# Merge with any previously discovered subdomains instead of overwriting,
# so subdomains that go dead (and drop out of subfinder's results) stay
# documented rather than disappearing from the list.
{
  [ -f "$2" ] && cat "$2"
  subfinder -d "$1" -all -silent | sed 's/^www\.//'
} | sort -u > "$2.tmp" && mv "$2.tmp" "$2"

echo
echo "Subdomains written to $2 (existing entries preserved)"
