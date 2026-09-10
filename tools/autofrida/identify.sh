#!/bin/bash

SRC_CSV="$1"
OUT_CSV="$2"

echo "domain, subdomain, ip, port, finding,output" > "$OUT_CSV"
while IFS=',' read -r domain subdomain ip port; do

    if [[ $port == 22 ]]; then

        ssh_out=$( ssh -vvv -o BatchMode=yes -o PreferredAuthentications=none "root@$ip" </dev/null 2>&1 )

        auth_methods=$( echo "$ssh_out" | grep 'Authentications that can continue:' | sed 's/.*Authentications that can continue: //' )
        [[ -z $auth_methods ]] && continue
        echo "$domain,$subdomain,$ip,$port, SSH Authentication Methods: $auth_methods" >> "$OUT_CSV"
    fi

    if [[ $port == 80 ]]; then
        curl_out=$(curl -sLI "$subdomain")

        # Server fingerprinting
        server=$( printf '%s\n' "$curl_out" | grep -i '^server:' | grep -oiP '(?<=server:\s).*')
        [[ -z $server ]] && continue
        echo "$domain,$subdomain,$ip,$port, Server Fingerprinting, Webserver: $server" >> "$OUT_CSV"

        # Information Disclosure
        info=$( printf '%s\n' "$curl_out" | grep -i '^x-powered-by:' | grep -oiP '(?<=x-powered-by:\s).*')
        echo "$domain,$subdomain,$ip,$port, Information Disclosure, Information disclosure: $info" >> "$OUT_CSV"
    fi

    if [[ $port == 443 ]]; then
        curl_out=$( curl -sLI "$subdomain" )

        server=$( printf '%s\n' "$curl_out" | grep -i '^server:' | grep -oiP '(?<=server:\s).*')
        [[ -z $server ]] && continue
        echo "$domain,$subdomain,$ip,$port,Server Fingerprinting, Webserver: $server" >> "$OUT_CSV"  

        # Information Disclosure
        info=$( printf '%s\n' "$curl_out" | grep -i '^x-powered-by:' | grep -oiP '(?<=x-powered-by:\s).*')
        echo "$domain,$subdomain,$ip,$port, Information Disclosure, Information disclosure: $info" >> "$OUT_CSV"  
    fi
done < "$SRC_CSV"
