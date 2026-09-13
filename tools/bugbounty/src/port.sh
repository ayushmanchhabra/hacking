#!/bin/bash
#
# Usage: ./port.sh <dns.csv> <output.csv>
#        KILLCHAIN_BIN=/path/to/killchain ./port.sh <dns.csv> <output.csv>
#
# Requires: killchain

input=$1
outfile=$2

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: killchain needs raw sockets, rerun as root/sudo." >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
killchain_bin="${KILLCHAIN_BIN:-$script_dir/../../killchain/out/bin/killchain}"

if [ ! -x "$killchain_bin" ]; then
  echo "Error: killchain binary not found at $killchain_bin (build: cd ${script_dir}/../../killchain && make)" >&2
  exit 1
fi

# Get URI,IP pairs from A records
pairs=$(awk -F',' '$2=="A"{ip=$3; gsub(/"/,"",ip); print $1","ip}' "$input")

# Scan each distinct IP once, cache ports by IP.
declare -A PORTS
scan=$(mktemp --suffix=.csv)
trap 'rm -f "$scan"' EXIT

while IFS= read -r ip; do
  [ -n "$ip" ] || continue
  : > "$scan"
  printf 'y\ny\ny\n' | sudo "$killchain_bin" "$ip" "$scan" >/dev/null 2>&1
  PORTS["$ip"]=$(awk -F',' '$1=="port"{print $3}' "$scan" | sort -nu | paste -sd, -)
done < <(cut -d, -f2 <<< "$pairs" | sort -u | grep -v '^[[:space:]]*$')

{
  echo "URI,IP,Ports"
  while IFS=, read -r uri ip; do
    [ -n "$uri" ] || continue
    echo "$uri,$ip,\"${PORTS[$ip]:-NA}\""
  done <<< "$pairs" | sort -u
} > "$outfile"

echo
echo " [ INFO ] Port results written to $outfile"
