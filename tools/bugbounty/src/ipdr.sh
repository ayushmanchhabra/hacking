#!/bin/bash
#
# Usage: ./ipdr.sh <dns.csv> <output.csv>
#        IPINFO_TOKEN=xxx ./ipdr.sh dns.csv out.csv
#
# each unique IP via ipinfo.io. Requires: curl, jq

input=$1
outfile=$2

auth=()
[ -n "${IPINFO_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${IPINFO_TOKEN}")

# Unique IPs from A and AAAA records (ipinfo handles both v4 and v6).
ips=$(awk -F',' '($2=="A" || $2=="AAAA"){ip=$3; gsub(/"/,"",ip); print ip}' "$input" | sort -u)

{
  echo "IP,HOSTNAME,CITY,REGION,COUNTRY,LOC,ORG,POSTAL,TIMEZONE,README,ANYCAST"

  while IFS= read -r ip; do
    [ -n "$ip" ] || continue
    curl -sL --max-time 10 "${auth[@]}" "https://ipinfo.io/${ip}" \
      | jq -r --arg ip "$ip" '
          ([$ip, .hostname, .city, .region, .country,
            .loc, .org, .postal, .timezone, .readme] | map(. // "NA"))
          + [(.anycast == true)]
          | @csv
        ' 2>/dev/null \
      || printf '"%s","NA","NA","NA","NA","NA","NA","NA","NA","NA",false\n' "$ip"
  done <<< "$ips" | sort -u
} > "$outfile"

echo
echo " [ INFO ] IPDR written to $outfile"
