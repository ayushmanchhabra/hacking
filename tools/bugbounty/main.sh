#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <domain|target> <output_dir>" >&2
}

if [ "$#" -ne 2 ]; then
  usage
  exit 1
fi

input_target="${1}"
output_dir="${2}"

if [ -z "$input_target" ] || [ -z "$output_dir" ]; then
  usage
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p -- "$output_dir"

"$script_dir/src/sub.sh" "$input_target" "$output_dir/subdomains.txt"
"$script_dir/src/dns.sh" "$output_dir/subdomains.txt" "$output_dir/dns_records.csv"
"$script_dir/src/crt.sh" "$output_dir/subdomains.txt" "$output_dir/tls_certificates.csv"

awk -F',' 'NR > 1 && ($2 == "A" || $2 == "AAAA") { print $3 }' "$output_dir/dns_records.csv" \
  | tr -d '"' | sort -u > "$output_dir/ips.txt"

if [ -s "$output_dir/ips.txt" ]; then
  "$script_dir/src/ipdr.sh" "$output_dir/ips.txt" "$output_dir/ipdr.csv"
  "$script_dir/src/port.sh" "$output_dir/ips.txt" "$output_dir/ports.csv"

  if awk -F',' 'NR > 1 && $2 != "NA" && $2 != "SKIPPED-IPV6" { found=1 } END { exit !found }' "$output_dir/ports.csv"; then
    "$script_dir/src/srv.sh" "$output_dir/ports.csv" "$output_dir/services.csv"
  else
    echo "No open ports found for $input_target, skipping service scan." >&2
  fi
else
  echo "No IPs resolved for $input_target, skipping ipdr/port scans." >&2
fi
