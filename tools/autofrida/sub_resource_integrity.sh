#!/bin/bash

SERVICES_CSV=$1
OUTPUT=$2

# Add CSV header
echo "subdomain,resource" > "$OUTPUT"

while IFS=, read -r subdomain ip port state service version; do
    echo "READ: $subdomain $port $state"
    # Only process if port is 443 and state is open
    if [[ "$port" == "443/tcp" && "$state" == "open" ]] || [[ "$port" == "80/tcp" && "$state" == "open" ]]; then
        echo "Processing $subdomain..."
        html_file="$subdomain.html"
        curl -s "https://$subdomain" -o "$html_file"

        resources=$(grep -Eo '<script[^>]+src="[^"]+"' "$html_file" \
            | grep -v integrity= \
            | sed -E 's/.*src="([^"]+)".*/\1/' \
            | grep -E '^https?:\/\/'
        )

        resources+=$'\n'$(grep -Eo '<link[^>]+rel="stylesheet"[^>]+href="[^"]+"' "$html_file" \
            | grep -v integrity= \
            | sed -E 's/.*href="([^"]+)".*/\1/' \
            | grep -E '^https?:\/\/'
        )

        # Write each resource as a new row in CSV
        while IFS= read -r res; do
            [[ -z "$res" ]] && continue
            echo "$subdomain,$res" >> "$OUTPUT"
        done <<< "$resources"
    fi
done < "$SERVICES_CSV"
