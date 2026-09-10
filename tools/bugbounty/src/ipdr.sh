#!/bin/bash
#
# Usage: ./ipdr.sh <ip|ips.txt> <output.csv>
#        IPINFO_TOKEN=xxx ./ipdr.sh ips.txt out.csv   # use an ipinfo.io API token
#
# Looks up each IP against https://ipinfo.io/<IP> and writes the response
# fields to a CSV.

if [ -z "$2" ]; then
  echo "Usage: $0 <ip|ips.txt> <output.csv>" >&2
  exit 1
fi

if [[ "$2" != *.csv ]]; then
  echo "Error: output file must have a .csv extension" >&2
  exit 1
fi

# commas -> semicolons, double quotes -> single, whitespace squeezed and trimmed
sanitize() {
  echo "$1" | sed 's/,/;/g' | sed 's/"/'"'"'/g' | tr -s ' ' | sed 's/^ *//; s/ *$//'
}

json_str_field() {
  echo "$1" | grep -oP "\"$2\"\s*:\s*\"\K[^\"]*" | head -1
}

json_bool_field() {
  echo "$1" | grep -oP "\"$2\"\s*:\s*\K(true|false)" | head -1
}

# Fail loudly if $1 looks like a file path but doesn't exist
if [[ "$1" == *.txt || "$1" == *.csv || "$1" == *.list || "$1" == */* ]] && [ ! -f "$1" ]; then
  echo "Error: file not found: $1" >&2
  exit 1
fi

if [ -f "$1" ]; then
  echo "Reading IPs from file: $1" >&2
  mapfile -t ips < <(tr -d '\r' < "$1" | grep -v '^[[:space:]]*$')
  echo "Loaded ${#ips[@]} IP(s)" >&2
  if [ "${#ips[@]}" -eq 0 ]; then
    echo "Error: no IPs found in $1" >&2
    exit 1
  fi
else
  echo "Treating input as a single IP: $1" >&2
  ips=("$1")
fi

{
  echo "URI,IP,HOSTNAME,CITY,REGION,COUNTRY,LOC,ORG,POSTAL,TIMEZONE,README,ANYCAST"

  for uri in "${ips[@]}"; do
    url="https://ipinfo.io/${uri}"
    [ -n "${IPINFO_TOKEN:-}" ] && url="${url}?token=${IPINFO_TOKEN}"

    resp=$(curl -sL "$url")

    ip=$(json_str_field "$resp" "ip")

    if [ -n "$ip" ]; then
      hostname=$(sanitize "$(json_str_field "$resp" "hostname")")
      city=$(sanitize "$(json_str_field "$resp" "city")")
      region=$(sanitize "$(json_str_field "$resp" "region")")
      country=$(sanitize "$(json_str_field "$resp" "country")")
      loc=$(sanitize "$(json_str_field "$resp" "loc")")
      org=$(sanitize "$(json_str_field "$resp" "org")")
      postal=$(sanitize "$(json_str_field "$resp" "postal")")
      timezone=$(sanitize "$(json_str_field "$resp" "timezone")")
      readme=$(sanitize "$(json_str_field "$resp" "readme")")
      anycast=$(json_bool_field "$resp" "anycast")

      [ -z "$hostname" ] && hostname="NA"
      [ -z "$city" ] && city="NA"
      [ -z "$region" ] && region="NA"
      [ -z "$country" ] && country="NA"
      [ -z "$loc" ] && loc="NA"
      [ -z "$org" ] && org="NA"
      [ -z "$postal" ] && postal="NA"
      [ -z "$timezone" ] && timezone="NA"
      [ -z "$readme" ] && readme="NA"
      [ -z "$anycast" ] && anycast="false"

      echo "$uri,$ip,$hostname,$city,$region,$country,$loc,$org,$postal,$timezone,$readme,$anycast"
    else
      echo "$uri,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA,NA"
    fi
  done
} > "$2"

{ head -n 1 "$2"; tail -n +2 "$2" | sort -u; } > "$2.tmp" && mv "$2.tmp" "$2"

echo
echo "IP data records written to $2"
echo
