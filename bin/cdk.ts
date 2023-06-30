#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('aws-cdk-lib');
import { VPCStack } from '../lib/cdk-stacks';
import { ClusterStack } from '../lib/cdk-stacks';
import { SecurityPlaygroundFargateStack } from '../lib/cdk-stacks';
import { OrchestrationStack } from '../lib/cdk-stacks';
import { InstrumentationStack } from '../lib/cdk-stacks';
import { ECRStack } from '../lib/cdk-stacks';
import { TGFargateStack } from '../lib/cdk-stacks';
import { ProfilingFargateStack } from '../lib/cdk-stacks';

const app = new cdk.App();
const env = { account: app.node.tryGetContext('account'), region: app.node.tryGetContext('region')}
const vpcStack = new VPCStack(app, 'FargateVPCStack', {env: env});
const clusterStack = new ClusterStack(app, 'FargateClusterStack', {vpc: vpcStack.vpc, env: env})
const orchestrationStack = new OrchestrationStack(app, 'FargateOrchestrationStack', {vpc: vpcStack.vpc, cluster: clusterStack.cluster, env: env})
const ecrStack = new ECRStack(app, 'FargateECRStack', {env: env});
const instrumentationStack = new InstrumentationStack(app, 'FargateInstrumentationStack', {repository: ecrStack.repository, env: env})
const securityPlaygroundStack = new SecurityPlaygroundFargateStack(app, 'FargateSecurityPlaygroundStack', {vpc: vpcStack.vpc, cluster: clusterStack.cluster, env: env})
const tgStack = new TGFargateStack(app, 'FargateTGStack', {vpc: vpcStack.vpc, cluster: clusterStack.cluster, env: env})
const profilingStack = new ProfilingFargateStack(app, 'ProfilingFargateStack', {vpc: vpcStack.vpc, cluster: clusterStack.cluster, env: env})
clusterStack.addDependency(vpcStack)
orchestrationStack.addDependency(clusterStack)
instrumentationStack.addDependency(orchestrationStack)
instrumentationStack.addDependency(ecrStack)
securityPlaygroundStack.addDependency(instrumentationStack)
tgStack.addDependency(instrumentationStack)
profilingStack.addDependency(instrumentationStack)