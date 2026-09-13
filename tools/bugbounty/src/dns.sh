#!/bin/bash
#
# Usage: ./dns.sh <host|hosts.txt> <output.csv>
#
# Requires: dig

input=$1
outfile=$2

if [ -f "$input" ]; then
  hosts=$(tr -d '\r' < "$input" | grep -v '^[[:space:]]*$')
else
  hosts=$input
fi

{
  echo "URI,DNS Record,DNS Value"
  while IFS= read -r raw; do
    host=${raw#*://}      # strip scheme
    host=${host%%[:/]*}   # strip port and path
    host=${host#www.}

    dig +noall +answer \
      "$host" A     "$host" AAAA "$host" CNAME "$host" MX \
      "$host" TXT   "$host" NS   "$host" SOA \
    | while read -r _ _ _ rtype value; do
        [ -n "$value" ] && printf '%s,%s,"%s"\n' "$host" "$rtype" "${value//\"/\"\"}"
      done
  done <<< "$hosts" | sort -u
} > "$outfile"

echo
echo " [ INFO ] DNS results written to $outfile"
