#!/bin/bash
#
# Usage: ./srv.sh <port.csv> <output.csv>
#
# Requires: nmap

input=$1
outfile=$2

# Cache nmap -sV results by IP so hosts shared by multiple URIs are scanned once.
declare -A SVC_CACHE

scan_ip() {
  local ip=$1 ports=$2
  nmap -sV -p "$ports" -oG - "$ip" 2>/dev/null | awk '
    /^Host:/ {
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
              print f[1] "," svc ",\"" ver "\""
            }
          }
        }
      }
    }
  '
}

{
  echo "URI,IP,port,service,version"

  while IFS=, read -r uri ip ports; do
    uri=${uri//[$'\r'\"]/}
    ip=${ip//[$'\r'\"]/}
    ports=${ports//[$'\r'\"]/}

    case "$uri" in URI|"") continue ;; esac   # header / blank
    case "$ports" in NA|"") continue ;; esac  # nothing to scan

    if [ -z "${SVC_CACHE[$ip]+x}" ]; then
      SVC_CACHE[$ip]=$(scan_ip "$ip" "$ports")
    fi

    [ -n "${SVC_CACHE[$ip]}" ] || continue
    while IFS= read -r line; do
      echo "$uri,$ip,$line"
    done <<< "${SVC_CACHE[$ip]}"
  done < "$input" | sort -u
} > "$outfile"

echo
echo " [ INFO ] Service info written to $outfile"
