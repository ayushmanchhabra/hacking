nping --icmp --icmp-type 13 $1 -c 5 | grep -e RCVD -e recv
nping --icmp --icmp-type 14 $1 -c 5 | grep -e RCVD -e recv
