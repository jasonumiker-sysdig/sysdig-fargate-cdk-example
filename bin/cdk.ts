#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('aws-cdk-lib');
import { VPCStack } from '../lib/cdk-stacks';
import { ClusterStack } from '../lib/cdk-stacks';
import { SecurityPlaygroundFargateServiceStack } from '../lib/cdk-stacks';
import { SecurityPlaygroundManualFargateServiceStack } from '../lib/cdk-stacks';

const app = new cdk.App();
const env = { account: app.node.tryGetContext('account'), region: app.node.tryGetContext('region')}
const vpcStack = new VPCStack(app, 'VPCStack', {env: env});
const clusterStack = new ClusterStack(app, 'ClusterStack', {vpc: vpcStack.vpc, env: env})
new SecurityPlaygroundFargateServiceStack(app, 'SecurityPlaygroundFargateServiceStack', {vpc: vpcStack.vpc, cluster: clusterStack.cluster, env: env})
new SecurityPlaygroundManualFargateServiceStack(app, 'SecurityPlaygroundManualFargateServiceStack', {vpc: vpcStack.vpc, cluster: clusterStack.cluster, env: env})
