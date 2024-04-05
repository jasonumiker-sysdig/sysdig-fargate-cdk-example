#!/bin/bash

DOMAIN=app.au1.sysdig.com
CLUSTER_NAME=microk8s-cluster
TOKEN=xxx

curl --location --request POST "https://$DOMAIN/api/cspm/v1/tasks" \
--header "Authorization: Bearer $TOKEN" \
--header "Content-Type: application/json" \
--data-raw '{
    "task": {
        "name": "Cloud Scan - AWS",
        "type": 6,
        "parameters": {
            "providerType": "aws"
        }
    }
}'