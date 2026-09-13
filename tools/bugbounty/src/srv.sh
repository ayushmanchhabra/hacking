#!/bin/bash
#
# Usage: ./srv.sh <port.csv> <output.csv>
#
# Requires: nmap

input=$1
outfile=$2

{
  echo "URI,IP,port,service,version"

  while IFS=, read -r uri ip ports; do
    uri=${uri//[$'\r'\"]/}
    ip=${ip//[$'\r'\"]/}
    ports=${ports//[$'\r'\"]/}

    case "$uri" in URI|"") continue ;; esac   # header / blank
    case "$ports" in NA|"") continue ;; esac  # nothing to scan

    nmap -sV -p "$ports" -oG - "$ip" 2>/dev/null | awk -v uri="$uri" -v ip="$ip" '
      /^Host:/ {
        for (i = 1; i <= NF; i++) {}          # no-op; keep gawk/mawk happy
        n = split($0, tab, "\t")
        for (i = 1; i <= n; i++) {
          if (tab[i] ~ /^Ports:/) {
            sub(/^Ports: /, "", tab[i])
            m = split(tab[i], ent, "/, ")       # entries end in "/"; "/" is escaped
                                                 # to "|" inside fields, so this is safe
            for (j = 1; j <= m; j++) {
              split(ent[j], f, "/")            # f[1]=port f[2]=state f[5]=service
              if (f[2] == "open") {
                svc = (f[5] == "" ? "unknown" : f[5])
                ver = f[7]
                gsub(/"/, "\"\"", ver)          # CSV-escape embedded quotes
                print uri "," ip "," f[1] "," svc ",\"" ver "\""
              }
            }
          }
        }
      }
    '
  done < "$input" | sort -u
} > "$outfile"

echo
echo " [ INFO ] Service info written to $outfile"
