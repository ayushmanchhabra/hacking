#!/bin/bash
#
# Usage: ./srv.sh <ports.csv> <output.csv>
#
# Reads the IP,PORTS output of port.sh and runs `nmap -p <ports> <ip>`
# against each host to identify the service behind each open port.
# Hosts with no open ports (NA) or skipped IPv6 rows are ignored.

if [ -z "$2" ]; then
  echo "Usage: $0 <ports.csv> <output.csv>" >&2
  exit 1
fi

if [[ "$2" != *.csv ]]; then
  echo "Error: output file must have a .csv extension" >&2
  exit 1
fi

if ! command -v nmap >/dev/null 2>&1; then
  echo "Error: nmap not found in PATH." >&2
  exit 1
fi

if [ ! -f "$1" ]; then
  echo "Error: file not found: $1" >&2
  exit 1
fi

echo "Reading ports from file: $1" >&2

declare -A host_ports
host_order=()

while IFS=',' read -r uri ports; do
  uri=$(tr -d '\r"' <<< "$uri")
  ports=$(tr -d '\r"' <<< "$ports")

  [ "$uri" = "IP" ] && continue
  [ -z "$uri" ] && continue
  [ "$ports" = "NA" ] && continue
  [ "$ports" = "SKIPPED-IPV6" ] && continue

  host_ports["$uri"]="$ports"
  host_order+=("$uri")
done < "$1"

echo "Loaded ${#host_order[@]} host(s) with open ports" >&2

if [ "${#host_order[@]}" -eq 0 ]; then
  echo "Error: no hosts with open ports found in $1" >&2
  exit 1
fi

{
  echo "uri,port,service"

  for uri in "${host_order[@]}"; do
    ports="${host_ports[$uri]}"
    echo "Scanning $uri (ports: $ports)..." >&2

    grepable=$(nmap -p "$ports" -oG - "$uri" 2>/dev/null | grep '^Host:')

    if [ -z "$grepable" ]; then
      echo "$uri,NA,NA"
      continue
    fi

    ports_field=$(echo "$grepable" | grep -oP 'Ports:\s*\K.*')

    if [ -z "$ports_field" ]; then
      echo "$uri,NA,NA"
      continue
    fi

    IFS=',' read -ra entries <<< "$ports_field"
    for entry in "${entries[@]}"; do
      entry=$(echo "$entry" | sed 's/^ *//; s/ *$//')
      port=$(echo "$entry" | cut -d'/' -f1)
      state=$(echo "$entry" | cut -d'/' -f2)
      service=$(echo "$entry" | cut -d'/' -f5)

      [ "$state" != "open" ] && continue
      [ -z "$service" ] && service="unknown"

      echo "$uri,$port,$service"
    done
  done
} > "$2"

{ head -n 1 "$2"; tail -n +2 "$2" | sort -u; } > "$2.tmp" && mv "$2.tmp" "$2"

echo
echo "Service info written to $2"
echo
