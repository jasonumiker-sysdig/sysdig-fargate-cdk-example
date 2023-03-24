import cdk = require('aws-cdk-lib');
import { Construct } from 'constructs';

export class VPCStack extends cdk.Stack {
  public readonly vpc: cdk.aws_ec2.Vpc;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC with a single t2.micro EC2 Instance NAT provider (under the free tier)
    this.vpc = new cdk.aws_ec2.Vpc(this, 'MyVpc', { 
      maxAzs: 2,
      natGateways: 1,
      natGatewayProvider: cdk.aws_ec2.NatProvider.instance({instanceType: new cdk.aws_ec2.InstanceType('t2.micro'),})
    });
  }
}

interface ClusterStackProps extends cdk.StackProps {
  vpc: cdk.aws_ec2.Vpc;
}

export class ClusterStack extends cdk.Stack {
  public readonly cluster: cdk.aws_ecs.Cluster;

  constructor(scope: Construct, id: string, props: ClusterStackProps) {
    super(scope, id, props);

    const {vpc} = props;

    // Create Fargate Cluster
    this.cluster = new cdk.aws_ecs.Cluster(this, 'Cluster', { vpc });
  }
}

interface FargateServiceStackProps extends cdk.StackProps {
  vpc: cdk.aws_ec2.Vpc;
  cluster: cdk.aws_ecs.Cluster;
}

export class SecurityPlaygroundFargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FargateServiceStackProps) {
    super(scope, id, props);

    const {vpc} = props;
    const {cluster} = props;

    // Instantiate Fargate Service with just cluster and image and port
    const fargateService = new cdk.aws_ecs_patterns.ApplicationLoadBalancedFargateService(this, 'securityplayground-service', {
      cluster,
      taskImageOptions: {
        image: cdk.aws_ecs.ContainerImage.fromRegistry("sysdiglabs/security-playground:latest"),
        containerPort: 8080,
        command: ["gunicorn", "-b", ":8080", "--workers", "2", "--threads", "4", "--worker-class", "gthread", "--access-logfile", "-", "--error-logfile", "-", "app:app"],
      },
      publicLoadBalancer: this.node.tryGetContext('public_load_balancer'),
    });

    // Configure our health check URL
    // If sysdig_shadow_shadow_healthcheck is true then we'll retrieve /etc/shadow
    if (this.node.tryGetContext('sysdig_etc_shadow_healthcheck') == "true") {
      fargateService.targetGroup.configureHealthCheck({
        path: "/etc/shadow",
        interval: cdk.Duration.minutes(5),
      });
    }
    // Otherwise we'll hit the 'normal' healthcheck endpoint
    else {
      fargateService.targetGroup.configureHealthCheck({
        path: "/health",
      });
    }

    // Add the permissions for the Sysdig CW Logs to the Task Execution Role
    const sysdigLogGroup = "arn:aws:logs:" + this.region + ":" + this.account + ":log-group:"+ this.node.tryGetContext('sysdig_logroup_name') +":*"
    const policyStatement = new cdk.aws_iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [sysdigLogGroup],
    })
    fargateService.taskDefinition.addToExecutionRolePolicy(policyStatement)

    // Add the Transform
    this.templateOptions.transforms = [this.node.tryGetContext('sysdig_transform_name')]
  }
}

// This optional stack shows what it would take to manually instrument a Task so you don't need to do the CF Transform
export class SecurityPlaygroundManualInstrumentationFargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FargateServiceStackProps) {
    super(scope, id, props);

    const {vpc} = props;
    const {cluster} = props;

    // Instantiate Fargate Service with just cluster and image and port
    const fargateService = new cdk.aws_ecs_patterns.ApplicationLoadBalancedFargateService(this, 'securityplayground-service', {
      cluster,
      taskImageOptions: {
        image: cdk.aws_ecs.ContainerImage.fromRegistry("sysdiglabs/security-playground:latest"),
        containerPort: 8080,
        // Use Sysdig's agent as the entryPoint - so it runs your command
        entryPoint: ['/opt/draios/bin/instrument'],
        command: ["gunicorn", "-b", ":8080", "--workers", "2", "--threads", "4", "--worker-class", "gthread", "--access-logfile", "-", "--error-logfile", "-", "app:app"],
      },
      publicLoadBalancer: this.node.tryGetContext('public_load_balancer'),
    });
    // Add the required SYS_PTRACE required KernelCapability
    fargateService.taskDefinition.findContainer('web')?.linuxParameters?.addCapabilities(cdk.aws_ecs.Capability.SYS_PTRACE)

    // Configure our health check URL
    // If sysdig_shadow_shadow_healthcheck is true then we'll retrieve /etc/shadow
    if (this.node.tryGetContext('sysdig_shadow_shadow_healthcheck') == "true") {
      fargateService.targetGroup.configureHealthCheck({
        path: "/etc/shadow",
        interval: cdk.Duration.minutes(5),
      });
    }
    // Otherwise we'll hit the 'normal' healthcheck endpoint
    else {
      fargateService.targetGroup.configureHealthCheck({
        path: "/health",
      });
    }

    // Add the permissions for the Sysdig CW Logs to the Task Execution Role
    const sysdigLogGroup = "arn:aws:logs:" + this.region + ":" + this.account + ":log-group:"+ this.node.tryGetContext('sysdig_logroup_name') +":*"
    const policyStatement = new cdk.aws_iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [sysdigLogGroup],
    })
    fargateService.taskDefinition.addToExecutionRolePolicy(policyStatement)

    // Add our sidecar to the Task Definition
    const sidecarContainer = fargateService.taskDefinition.addContainer('sysdig-sidecar-container', {
      image: cdk.aws_ecs.ContainerImage.fromRegistry("quay.io/sysdig/workload-agent:latest"),
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        streamPrefix: "sysdig",
        logGroup: cdk.aws_logs.LogGroup.fromLogGroupName(this, 'loggroup', this.node.tryGetContext('sysdig_logroup_name')),
      }),
      entryPoint: ['/opt/draios/bin/logwriter'],
    });

    // Mount our sidecar into your container as a volume
    const volumeFrom: cdk.aws_ecs.VolumeFrom = {
      readOnly: true,
      sourceContainer: sidecarContainer.containerName,
    };
    fargateService.taskDefinition.findContainer('web')?.addVolumesFrom({readOnly: true, sourceContainer: sidecarContainer.containerName})

    // Set all the needed SYSDIG environment variables in your container
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_ORCHESTRATOR", this.node.tryGetContext('SYSDIG_ORCHESTRATOR'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_ORCHESTRATOR_PORT", this.node.tryGetContext('SYSDIG_ORCHESTRATOR_PORT'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_LOGGING", this.node.tryGetContext('SYSDIG_LOGGING'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_ACCESS_KEY", this.node.tryGetContext('SYSDIG_ACCESS_KEY'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_COLLECTOR", this.node.tryGetContext('SYSDIG_COLLECTOR'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_COLLECTOR_PORT", this.node.tryGetContext('SYSDIG_COLLECTOR_PORT'))
  }
}