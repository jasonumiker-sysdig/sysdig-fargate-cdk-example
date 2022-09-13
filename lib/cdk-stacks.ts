import cdk = require('aws-cdk-lib');
import { EcsApplication } from 'aws-cdk-lib/aws-codedeploy';
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

export class SecurityPlaygroundFargateServiceStack extends cdk.Stack {
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
      },
    });

    // Configure our health check URL
    fargateService.targetGroup.configureHealthCheck({
      path: "/health",
    });

    // Add our entrypoint
    // We need to do this here because of https://github.com/aws/aws-cdk/issues/17092
    const cfnTaskDef = fargateService.taskDefinition.node.defaultChild as cdk.aws_ecs.CfnTaskDefinition;
    cfnTaskDef.addOverride('Properties.ContainerDefinitions.0.Command', ["gunicorn", "-b", ":8080", "--workers", "2", "--threads", "4", "--worker-class", "gthread", "--access-logfile", "-", "--error-logfile", "-", "app:app"])

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

export class SecurityPlaygroundManualFargateServiceStack extends cdk.Stack {
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
      },
    });

    // Configure our health check URL
    fargateService.targetGroup.configureHealthCheck({
      path: "/health",
    });

    // Manually Instrument this for Sysdig rather than using the Transform

    // Add the permissions for the Sysdig CW Logs to the Task Execution Role
    const sysdigLogGroup = "arn:aws:logs:" + this.region + ":" + this.account + ":log-group:"+ this.node.tryGetContext('sysdig_logroup_name') +":*"
    const policyStatement = new cdk.aws_iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [sysdigLogGroup],
    })
    fargateService.taskDefinition.addToExecutionRolePolicy(policyStatement)

    // First let's add our sidecar container to the Task Definition
    const sidecarContainer = fargateService.taskDefinition.addContainer('sysdig-sidecar-container', {
      image: cdk.aws_ecs.ContainerImage.fromRegistry("quay.io/sysdig/workload-agent:latest"),
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        streamPrefix: "sysdig",
        logGroup: cdk.aws_logs.LogGroup.fromLogGroupName(this, 'loggroup', this.node.tryGetContext('sysdig_logroup_name')),
      }),
    });

    // Then mount our sidecar into your container as a volume
    const volumeFrom: cdk.aws_ecs.VolumeFrom = {
      readOnly: true,
      sourceContainer: sidecarContainer.containerName,
    };
    fargateService.taskDefinition.findContainer('web')?.addVolumesFrom({readOnly: true, sourceContainer: sidecarContainer.containerName})

    // Then set the appropriate environment variables
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_ORCHESTRATOR", this.node.tryGetContext('SYSDIG_ORCHESTRATOR'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_ORCHESTRATOR_PORT", this.node.tryGetContext('SYSDIG_ORCHESTRATOR_PORT'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_LOGGING", this.node.tryGetContext('SYSDIG_LOGGING'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_ACCESS_KEY", this.node.tryGetContext('SYSDIG_ACCESS_KEY'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_COLLECTOR", this.node.tryGetContext('SYSDIG_COLLECTOR'))
    fargateService.taskDefinition.findContainer('web')?.addEnvironment("SYSDIG_COLLECTOR_PORT", this.node.tryGetContext('SYSDIG_COLLECTOR_PORT'))

    // Then set our service as the Entrypoint for your container (which then runs your service via commands)
    const cfnTaskDef = fargateService.taskDefinition.node.defaultChild as cdk.aws_ecs.CfnTaskDefinition;
    cfnTaskDef.addOverride('Properties.ContainerDefinitions.0.EntryPoint', ['/opt/draios/bin/instrument'])
    cfnTaskDef.addOverride('Properties.ContainerDefinitions.0.Command', ["gunicorn", "-b", ":8080", "--workers", "2", "--threads", "4", "--worker-class", "gthread", "--access-logfile", "-", "--error-logfile", "-", "app:app"])
    
    // Then set the Entrypoint for our container as well
    cfnTaskDef.addOverride('Properties.ContainerDefinitions.1.EntryPoint', ['/opt/draios/bin/logwriter'])

    // Then finally add our SYS_PTRACE required KernelCapability
    cfnTaskDef.addOverride('Properties.ContainerDefinitions.0.linuxParameters.capabilities.add',['SYS_PTRACE'])
  }
}