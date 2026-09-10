#!/bin/bash

DOMAIN=""
OUTPUT=""
ENUM_SUBDOMAIN=true
ENUM_SERVICE=true

# Parse arguments
for arg in "$@"; do
    case $arg in
        --subdomain=*)
            ENUM_SUBDOMAIN="${arg#*=}"
            shift
            ;;
        --service=*)
            ENUM_SERVICE="${arg#*=}"
            shift
            ;;
        *)
            if [[ -z "$DOMAIN" ]]; then
                DOMAIN="$arg"
            elif [[ -z "$OUTPUT" ]]; then
                OUTPUT="$arg"
            fi
            ;;
    esac
done

if [[ -z "$DOMAIN" || -z "$OUTPUT" ]]; then
    echo "Usage: $0 <domain> <output.csv> [--subdomain=true|false] [--service=true|false]" >&2
    exit 1
fi

echo "domain,subdomain,ip,port" > "$OUTPUT"

# -------------------------
# Subdomain Enumeration
# -------------------------
if [[ "$ENUM_SUBDOMAIN" == "true" ]]; then
    echo "[ INFO ] Enumerating subdomains for $DOMAIN..." >&2
    SUB_DOMAINS=$(subfinder -silent -d "$DOMAIN" | sed 's/^www\.//' | sort -u)
else
    echo "[ INFO ] Skipping subdomain enumeration" >&2
    SUB_DOMAINS="$DOMAIN"
fi

[[ -z "$SUB_DOMAINS" ]] && SUB_DOMAINS="$DOMAIN"

while IFS= read -r subdomain; do
    [[ -z "$subdomain" ]] && continue
    echo "[ INFO ] Enumerating subdomain $subdomain..." >&2

    # -------------------------
    # IP Enumeration
    # -------------------------
    IPS=$(dig -4 +short A "$subdomain")

    if [[ -z "$IPS" ]]; then
        echo "$DOMAIN,$subdomain,NA,NA" >> "$OUTPUT"
        continue
    fi

    while IFS= read -r ip; do
        [[ -z "$ip" ]] && continue

        # -------------------------
        # Service Enumeration
        # -------------------------
        if [[ "$ENUM_SERVICE" == "true" ]]; then
            echo "[ INFO ] Enumerating services on $ip..." >&2
            PORTS=$(rustscan -a "$ip" -r 1-65535 | grep '^Open' | awk -F':' '{print $2}')

            if [[ -z "$PORTS" ]]; then
                echo "$DOMAIN,$subdomain,$ip,NA" >> "$OUTPUT"
                continue
            fi

            while IFS= read -r port; do
                echo "$DOMAIN,$subdomain,$ip,$port" >> "$OUTPUT"
            done <<< "$PORTS"
        else
            echo "[ INFO ] Skipping service enumeration for $ip" >&2
            echo "$DOMAIN,$subdomain,$ip,NA" >> "$OUTPUT"
        fi

    done <<< "$IPS"

done <<< "$SUB_DOMAINS"
