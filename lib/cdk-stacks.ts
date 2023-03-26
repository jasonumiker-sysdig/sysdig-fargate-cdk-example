import cdk = require('aws-cdk-lib');
import * as cfninc from 'aws-cdk-lib/cloudformation-include';
import { Construct } from 'constructs';
import * as ecrdeploy from 'cdk-ecr-deployment';

export class ECRStack extends cdk.Stack {
  public readonly repository: cdk.aws_ecr.Repository;
  
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // Create an ECR for our SysdigServerlessPatcherImage
    this.repository = new cdk.aws_ecr.Repository(this, 'ECRRepository', {
      repositoryName: "serverless-patcher",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteImages: true,
    });

    // Copy our image from quay to our new ECR
    new ecrdeploy.ECRDeployment(this, 'DeployDockerImage', {
      src: new ecrdeploy.DockerImageName('quay.io/sysdig/serverless-patcher:4.0.0'),
      dest: new ecrdeploy.DockerImageName(`${this.repository.repositoryUri}:4.0.0`),
    });
  }
}

export class VPCStack extends cdk.Stack {
  public readonly vpc: cdk.aws_ec2.Vpc;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC with only public subnets (which is free without NATs)
    // but we can still have 'private' things if no public IP assigned
    this.vpc = new cdk.aws_ec2.Vpc(this, 'VPC', {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC
        }
      ],
      natGateways: 0
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

    const { vpc } = props;

    // Create Fargate Cluster
    this.cluster = new cdk.aws_ecs.Cluster(this, 'Cluster', {
      vpc: vpc,
    });
  }
}

interface FargateServiceStackProps extends cdk.StackProps {
  vpc: cdk.aws_ec2.Vpc;
  cluster: cdk.aws_ecs.Cluster;
}

// Deploy the Sysdig Fargate Orchestration Stack
export class OrchestrationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FargateServiceStackProps) {
    super(scope, id, props);

    const { vpc } = props;

    const template = new cfninc.CfnInclude(this, 'OrchestrationTemplate', {
      templateFile: 'orchestrator-agent.yaml',
      parameters: {
        SysdigAccessKey: this.node.tryGetContext('SYSDIG_ACCESS_KEY'),
        SysdigCollectorHost: this.node.tryGetContext('SYSDIG_COLLECTOR'),
        SysdigCollectorPort: this.node.tryGetContext('SYSDIG_COLLECTOR_PORT'),
        VPC: vpc.vpcId,
        SubnetA: vpc.publicSubnets.at(0)?.subnetId,
        SubnetB: vpc.publicSubnets.at(1)?.subnetId,
        NetworkType: "Public Subnet",
        SysdigAgentTags: "",
        SysdigOrchestratorAgentImage: "quay.io/sysdig/orchestrator-agent:4.0.0",
        SysdigCheckCollectorCertificate: "true",
        SysdigOrchestratorAgentPort: "6667"
      },
    });
  }
}

interface InstrumentationStackProps extends cdk.StackProps {
  repository: cdk.aws_ecr.Repository;
}

// Deploy the Sysdig Fargate Instrumentation Stack
export class InstrumentationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InstrumentationStackProps) {
    super(scope, id, props);

    const { repository } = props;

    const template = new cfninc.CfnInclude(this, 'InstrumentationTemplate', {
      templateFile: 'instrumentation.yaml',
      parameters: {
        SysdigOrchestratorAgentHost: cdk.Fn.importValue('SysdigFargateOrchestrationHost'),
        SysdigOrchestratorAgentPort: cdk.Fn.importValue('SysdigFargateOrchestrationPort'),
        SysdigMacroName: "SysdigMacro",
        SysdigInstrumentationLogLevel: "info",
        SysdigServerlessPatcherImage: repository.repositoryUri + ":4.0.0",
        SysdigWorkloadAgentImage: "quay.io/sysdig/workload-agent:4.0.0",
      },
    });
  }
}

  export class SecurityPlaygroundFargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FargateServiceStackProps) {
    super(scope, id, props);

    const { vpc } = props;
    const { cluster } = props;

    // Instantiate Fargate Service with just cluster and image and port
    const fargateService = new cdk.aws_ecs_patterns.ApplicationLoadBalancedFargateService(this, 'securityplayground-service', {
      cluster,
      taskImageOptions: {
        image: cdk.aws_ecs.ContainerImage.fromRegistry("sysdiglabs/security-playground:latest"),
        containerPort: 8080,
        command: ["gunicorn", "-b", ":8080", "--workers", "2", "--threads", "4", "--worker-class", "gthread", "--access-logfile", "-", "--error-logfile", "-", "app:app"],
      },
      publicLoadBalancer: this.node.tryGetContext('public_load_balancer'),
      assignPublicIp: true
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
    const sysdigLogGroup = "arn:aws:logs:" + this.region + ":" + this.account + ":log-group:" + cdk.Fn.importValue("SysdigLogGroup") + ":*"
    const policyStatement = new cdk.aws_iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [sysdigLogGroup],
    })
    fargateService.taskDefinition.addToExecutionRolePolicy(policyStatement)

    // Add the Transform
    this.templateOptions.transforms = ["SysdigMacro"]
  }
}