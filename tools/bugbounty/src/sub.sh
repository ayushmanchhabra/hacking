#!/bin/bash

domain=$1
outfile=$2
staged="/tmp/$(basename "$outfile")"

if [ -f "$outfile" ]; then
  cp "$outfile" "$staged"
else
  : > "$staged"
fi

subfinder -d "$domain" -all -silent \
  | sed 's/^www\.//' \
  >> "$staged"

sort -u -o "$outfile" "$staged"

rm -rf "$staged"

echo
echo " [ INFO ] Subdomains written to $outfile"
