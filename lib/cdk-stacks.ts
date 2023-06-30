import cdk = require('aws-cdk-lib');
import * as cfninc from 'aws-cdk-lib/cloudformation-include';
import { Construct } from 'constructs';
import * as ecrdeploy from 'cdk-ecr-deployment';
import { Capability, ContainerImage, FargateService, FargateTaskDefinition, LinuxParameters, LogDriver } from 'aws-cdk-lib/aws-ecs';
import { Peer, Port, Protocol, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationProtocolVersion, ApplicationTargetGroup, ListenerAction, TargetType} from 'aws-cdk-lib/aws-elasticloadbalancingv2';


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
      src: new ecrdeploy.DockerImageName('quay.io/sysdig/serverless-patcher:4.1.2'),
      dest: new ecrdeploy.DockerImageName(`${this.repository.repositoryUri}:4.1.2`),
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
        SysdigOrchestratorAgentImage: "quay.io/sysdig/orchestrator-agent:4.1.2",
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
        SysdigServerlessPatcherImage: repository.repositoryUri + ":4.1.2",
        SysdigWorkloadAgentImage: "quay.io/sysdig/workload-agent:4.1.2",
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
      image: cdk.aws_ecs.ContainerImage.fromRegistry("public.ecr.aws/m9h2b5e7/security-playground:110623"),
      containerPort: 8080,
      command: ["gunicorn", "-b", ":8080", "--workers", "2", "--threads", "4", "--worker-class", "gthread", "--access-logfile", "-", "--error-logfile", "-", "app:app"],
    },
    publicLoadBalancer: this.node.tryGetContext('public_load_balancer'),
    assignPublicIp: true,
    cpu: 1024,
    memoryLimitMiB: 2048
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

    // Export the LB address
    new cdk.CfnOutput(this, "SPALBAddress", {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      exportName: "SPALBAddress",
    });
  }
}

export class TGFargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FargateServiceStackProps) {
    super(scope, id, props);

    const { vpc } = props;
    const { cluster } = props;

    // Run this as a scheduled task every 15 minutes
    const fargateTask = new cdk.aws_ecs_patterns.ScheduledFargateTask(this, 'tg-service', {
      cluster,
      scheduledFargateTaskImageOptions: {
        image: cdk.aws_ecs.ContainerImage.fromRegistry("dockerbadboy/art:latest"),
        // Removed LOAD.BPF.PROG, RECON.LINPEAS and PROOT.EXEC which seem to crash the Task in Fargate
        command: ["pwsh", "-c", "(./RunTests.ps1 XMRIG.EXEC STDIN.NETWORK DEV.SHM.EXEC T1048 RECON.FIND.SUID T1611.002 CONTAINER.ESCAPE.NSENTER CREDS.DUMP.MEMORY KILL.MALICIOUS.PROC Base64.PYTHON BASE64.CLI Base64.SHELLSCRIPT CONNECT.UNEXPECTED RECON.GPG SUBTERFUGE.LASTLOG LD.LINUX.EXEC LD.SO.PRELOAD USERFAULTFD.HANDLER TIMESTOMP SUBTERFUGE.FILEBELOWDEV SYMLINK.ETC.SHADOW PRIVESC.SUDO)"],
        cpu: 2048,
        memoryLimitMiB: 8192,      
      },
      schedule: cdk.aws_applicationautoscaling.Schedule.expression('cron(0/15 * * * ? *)'),
      subnetSelection: {
        subnetType: cdk.aws_ec2.SubnetType.PUBLIC
      }
    });

    // Enable a public IP for this
    // See this GitHub issue for why we have to use CfnResource override
    // https://github.com/aws/aws-cdk/issues/9233
    (fargateTask.eventRule.node.defaultChild as cdk.CfnResource).addPropertyOverride(
      "Targets.0.EcsParameters.NetworkConfiguration.AwsVpcConfiguration.AssignPublicIp",
      "ENABLED"
    );

    // Add the permissions for the Sysdig CW Logs to the Task Execution Role
    const sysdigLogGroup = "arn:aws:logs:" + this.region + ":" + this.account + ":log-group:" + cdk.Fn.importValue("SysdigLogGroup") + ":*"
    const policyStatement = new cdk.aws_iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [sysdigLogGroup],
    })
    fargateTask.taskDefinition.addToExecutionRolePolicy(policyStatement)

    // Add the Transform
    this.templateOptions.transforms = ["SysdigMacro"]
  }
}

export class ProfilingFargateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FargateServiceStackProps) {
    super(scope, id, props);
  
    const { vpc } = props;
    const { cluster } = props;

    // Create Public LB

    const publicLBSecurityGroup = new SecurityGroup(this, "publicLBSecurityGroup", {
      vpc: vpc,
      allowAllOutbound: true,
      description: "Security group for the public ALB"
    })

    publicLBSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(80),
      "Allow port 80 ingress traffic"
    )

    const publicLB = new ApplicationLoadBalancer(this, "publicLB", {
      internetFacing: true,
      vpc: vpc,
      vpcSubnets: {onePerAz: true, subnetType: SubnetType.PUBLIC},
      securityGroup: publicLBSecurityGroup
    })

    publicLB.addListener("publicLBListener", {
      protocol: ApplicationProtocol.HTTP,
      defaultAction: ListenerAction.fixedResponse(500)
    })
    
    // Create Monitor LB

    const monitorLBSecurityGroup = new SecurityGroup(this, "monitorLBSecurityGroup", {
      vpc: vpc,
      allowAllOutbound: true,
      description: "Security group for the public ALB"
    })

    monitorLBSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(52323),
      "Allow port 52323 ingress traffic"
    )

    const monitorLB = new ApplicationLoadBalancer(this, "monitorLB", {
      internetFacing: true,
      vpc: vpc,
      vpcSubnets: {onePerAz: true, subnetType: SubnetType.PUBLIC},
      securityGroup: monitorLBSecurityGroup
    })

    monitorLB.addListener("monitorLBListener", {
      protocol: ApplicationProtocol.HTTP,
      port: 52323,
      defaultAction: ListenerAction.fixedResponse(500)
    })    
  
    // Create the ECS Fargate Task Defintion
    const taskDefinition = new FargateTaskDefinition(this, 'TaskDef', {
      cpu: 1024,
      memoryLimitMiB: 2048
    });

    taskDefinition.addVolume({
      name: "diagnostics"
    })

    taskDefinition.addVolume({
      name: "dumps"
    })    

    const linuxParams = new LinuxParameters(this, "sys-ptrace-linux-params");
    linuxParams.addCapabilities(Capability.SYS_PTRACE)

    const containerapp = taskDefinition.addContainer("containerapp", {
      cpu: 512,
      memoryLimitMiB: 1024,
      image: ContainerImage.fromRegistry('jasonumiker/profiling:latest'),
      linuxParameters: linuxParams,
      environment: {
        "DOTNET_Diagnostic_Ports": "/diag/port,nosuspend,connect"
      },
      logging: LogDriver.awsLogs({streamPrefix: "ecs"}),
      portMappings: [{containerPort: 80}],
      entryPoint: ["dotnet", "Profiling.Api.dll"],
      containerName: "container-app"
    })

    containerapp.addMountPoints(
      {
        containerPath: '/diag',
        sourceVolume: 'diagnostics',
        readOnly: false
      },
      {
        containerPath: '/dumps',
        sourceVolume: 'dumps',
        readOnly: false
      }
    )

    const dotnetmonitor = taskDefinition.addContainer("dotnet-monitor", {
      cpu: 256,
      memoryLimitMiB: 512,
      image: ContainerImage.fromRegistry('mcr.microsoft.com/dotnet/monitor:6'),
      environment: {
        "DOTNETMONITOR_DiagnosticPort__ConnectionMode": "Listen",
        "DOTNETMONITOR_DiagnosticPort__EndpointName": "/diag/port",
        "DOTNETMONITOR_Urls": "http://+:52323",
        "DOTNETMONITOR_Storage__DumpTempFolder": "/dumps"
      },
      command: ["--no-auth"],
      portMappings: [{containerPort: 52323}]
    })

    dotnetmonitor.addMountPoints(
      {
        containerPath: '/diag',
        sourceVolume: 'diagnostics',
        readOnly: false
      },
      {
        containerPath: '/dumps',
        sourceVolume: 'dumps',
        readOnly: false
      }
    )

    // Create the ECS Fargate Service

    const sg = new SecurityGroup(this, "sg", {
      description: "Allow traffic from ALB to app",
      allowAllOutbound: true,
      vpc: vpc
    })

    sg.connections.allowFrom(publicLB.connections, new Port(
      {
        fromPort: 80,
        toPort: 80,
        protocol: Protocol.TCP,
        stringRepresentation: "80"
      }
    ))

    sg.connections.allowFrom(publicLB.connections, new Port(
      {
        fromPort: 52323,
        toPort: 52323,
        protocol: Protocol.TCP,
        stringRepresentation: "52323"
      }
    ))

    // Add the permissions for the Sysdig CW Logs to the Task Execution Role
    const sysdigLogGroup = "arn:aws:logs:" + this.region + ":" + this.account + ":log-group:" + cdk.Fn.importValue("SysdigLogGroup") + ":*"
    const policyStatement = new cdk.aws_iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [sysdigLogGroup],
    })
    taskDefinition.addToExecutionRolePolicy(policyStatement)
    
    const service = new FargateService(this, "service", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: true,
      vpcSubnets: {subnets: vpc.publicSubnets},
      securityGroups: [sg]
    })

    // Create a target group for publicLB and attach it
    const target = service.loadBalancerTarget({
      containerPort: 80,
      containerName: "container-app",
      protocol: cdk.aws_ecs.Protocol.TCP
    })

    const targetGroup = new ApplicationTargetGroup(this, "tg-app-ecs-profiling-dotnet-demo", {
      vpc: vpc,
      targetType: TargetType.IP,
      protocolVersion: ApplicationProtocolVersion.HTTP1,
      healthCheck: {
        protocol: cdk.aws_elasticloadbalancingv2.Protocol.HTTP,
        healthyThresholdCount: 3,
        path: "/health",
        port: "80",
        interval: cdk.Duration.millis(10000),
        timeout: cdk.Duration.millis(8000),
        unhealthyThresholdCount: 10,
        healthyHttpCodes: "200"
      },
      port: 80,
      targets: [target]
    })

    publicLB.listeners[0].addTargetGroups("app-listener", {
      targetGroups: [targetGroup]
    })

    // Create a target group for monitorLB and attach it

    const targetMonitor = service.loadBalancerTarget({
      containerPort: 52323,
      containerName: "dotnet-monitor",
      protocol: cdk.aws_ecs.Protocol.TCP
    })

    const monitorGroup = new ApplicationTargetGroup(this, "tg-monitor-ecs-profiling-dotnet-demo", {
      vpc: vpc,
      targetType: TargetType.IP,
      protocolVersion: ApplicationProtocolVersion.HTTP1,
      protocol: ApplicationProtocol.HTTP,
      healthCheck: {
        protocol: cdk.aws_elasticloadbalancingv2.Protocol.HTTP,
        healthyThresholdCount: 3,
        path: "/info",
        port: "52323",
        interval: cdk.Duration.millis(10000),
        timeout: cdk.Duration.millis(8000),
        unhealthyThresholdCount: 10,
        healthyHttpCodes: "200"
      },
      port: 52323,
      targets: [targetMonitor]
    })

    monitorLB.listeners[0].addTargetGroups("monitor-listener", {
      targetGroups: [monitorGroup]
    })

    // Add the Transform
    this.templateOptions.transforms = ["SysdigMacro"]
  }
}