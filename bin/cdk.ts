#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('aws-cdk-lib');
import { VPCStack } from '../lib/cdk-stacks';
import { ClusterStack } from '../lib/cdk-stacks';
import { SecurityPlaygroundFargateStack } from '../lib/cdk-stacks';
import { SecurityPlaygroundManualInstrumentationFargateStack } from '../lib/cdk-stacks';

const app = new cdk.App();
const env = { account: app.node.tryGetContext('account'), region: app.node.tryGetContext('region')}
const vpcStack = new VPCStack(app, 'VPCStack', {env: env});
const clusterStack = new ClusterStack(app, 'ClusterStack', {vpc: vpcStack.vpc, env: env})
new SecurityPlaygroundFargateStack(app, 'SecurityPlaygroundFargateStack', {vpc: vpcStack.vpc, cluster: clusterStack.cluster, env: env})
new SecurityPlaygroundManualInstrumentationFargateStack(app, 'SecurityPlaygroundManualFargateStack', {vpc: vpcStack.vpc, cluster: clusterStack.cluster, env: env})