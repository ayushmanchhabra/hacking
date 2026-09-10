# https://www.tenable.com/cve/CVE-1999-0524
iptables -I INPUT -p icmp --icmp-type timestamp-request -j DROP
iptables -I OUTPUT -p icmp --icmp-type timestamp-reply -j DROP
