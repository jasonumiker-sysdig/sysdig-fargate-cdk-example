# Example of ECS Fargate using the CDK that works with Sysdig Secure

This is an example of using the [CDK's ECS Patterns construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html) in TypeScript in a way that will work with Sysdig's Fargate support.

I am going to add a Python example to this soon as well.

It is intended as an example to inspire you on how to change your own CDK so that Sysdig can transform/instrument it like it does with CloudFormation. It can also be useful as a way to test Fargate support within your Sysdig environment is working as it deploys [Sysdig's Security Playground](https://github.com/sysdiglabs/security-playground) to help facilitate triggering Events in Sysdig's Runtime Threat Detection feature(s).

The way that Sysdig's Fargate support works is that:
1. A sidecar container is added to each Task. 2. Then, your container is changed to mount theirs as a Volume
3. Then your entrypoint and commands are changed such that their service is run first and then it, in turns, run yours
3. Finally SYS_PTRACE is added - which Sysdig leverage in a special more efficient/peformant way to get visibility into the runtime activity of the container via a tool called pdig described in detail in this blog post - https://sysdig.com/blog/aws-fargate-runtime-security-ptrace-ld_preload/.

I give two examples here:
* The first, SecurityPlaygroundFargateStack,is leveraging the CloudFormation Transform provided by Sysdig to transform/instrument the Task Definition to add Sysdig to the Task.
* The second, SecurityPlaygroundManualFargateStack, is an example of how you'd 'manually' instrument your Task Definition to add Sysdig instead of using that CloudFormation Transform.

There are two CDK files - `bin/cdk.ts` which instatiates the stacks and `lib/cdk-stacks.ts` which is where most of the CDK code actually lives.

NOTE: This is not a supported thing from Sysdig (as Sysdig supports CloudFormation and Terraform) - but instead is an example I prepared on how to get CDK to generate the CloudFormation that, in turn, would be supported. Sysdig will help as long as your CDK generates the required/'right' CloudFormation - but it will be best effort in their helping you with CDK to get it go generate that CloudFormation as required. If you have support from AWS then should support the CDK to get you to that point.

## Usage

### Prerequisites
1. Ensure you've deployed the Sysdig Orchestrator Agent and Instrumention Service, Sysdig via the provided Sysdig CloudFormation Template - https://docs.sysdig.com/en/docs/installation/serverless-agents/aws-fargate-serverless-agents/#latest-cloudformation,
1. Then install node.js if required (using Homebrew or the OS pacakage repository such as apt, yum or dnf etc.)

### Install the CDK Stacks
1. First run `npm install` in this folder
2. Then prepare to deploy by editing `cdk.json`. There you can configure the following parameters:
* account - The AWS account to deploy to
* region - The AWS region to deploy to
* sysdig_transform_name - The transform name you specified when you deployed "SysdigMacro",
* sysdig_logroup_name - There was a LogGroup created by the Sysdig Instrumentation and Orchestration Stack specify it here (as our sidecar will send its logs there)
* sysdig_etc_shadow_healthcheck - If you don't want to curl the service yourself (for example to install it into an isolated environment you can't reach easily from a network perspective) then this will change the healthcheck to trigger a Sysdig Event every 5 minutes by changing it's healthcheck to retrieve /etc/shadow each time. 
* public_load_balancer - If you want to have the AWS ALB for this service on the Internet or not. I highly suggest leaving it false and interacting with this service off the Internet (as it is insecure by design to test Sysdig's Runtime Threat Detection)
* SYSDIG_ORCHESTRATOR - If you deployed the Sysdig Instrumentation and Orchestration Stack then this is the netork address of the Orchestration service. This is the suggested way to do it
* SYSDIG_ORCHESTRATOR_PORT - The port of the orchestration service. Usually 6667.
* SYSDIG_LOGGING - the verbosity of the logs of our per-task sidecars. Leave this as info unless troubleshooting.
* SYSDIG_ACCESS_KEY - The Sysdig Access Key - only needed if you want to bypass the Orchestrator and send things directly to Sysdig. Usually used if you don't want to deploy the Sysdig Instrumentation and Orchestration Stack. Not recomended.
* SYSDIG_COLLECTOR - The address of your Sysdig collector endpoint - only needed if you want to bypass the Orchestrator and send things directly to Sysdig. Usually used if you don't want to deploy the Sysdig Instrumentation and Orchestration Stack. Not recomended.
* SYSDIG_COLLECTOR_PORT - The port of the Sysdig Collector endpoint - only needed if you want to bypass the Orchestrator and send things directly to Sysdig. Usually used if you don't want to deploy the Sysdig Instrumentation and Orchestration Stack. Not recomended.
3. Run `npx cdk deploy SecurityPlaygroundFargateStack` or `npx cdk deploy SecurityPlaygroundManualFargateStack` depending on whether you want to let our automatic CloudFormation transform happen or if you want to deploy one that we've 'manually' done the transformation/instrumentation in the CDK instead.

NOTE: The SYSDIG_XXX environment variables are only used by SecurityPlaygroundManualFargateStack. SecurityPlaygroundFargateStack gets its environment variables automatically added by the CloudFormation Transform / Automation done by the Sysdig Instrumention Service.

### How to trigger Sysdig Events once deployed

This example deploys [Sysdig's Security Playground](https://github.com/sysdiglabs/security-playground) which is a insecure Python service that will allow you to read, write and execute things within the container via curl. 

NOTE: I highly suggest not putting this service's load balancer on the Internet, and instead interacting with it within your private VPC, as it is insecure by design in order to test Sysdig's Runtime Threat Detection is working as you'd expect with CDK and Fargate.

### Reading a file

You can read a file using just the URL.

```bash
$ curl [AWS ALB ADDRESS]/etc/shadow
```

This will return the content of the /etc/shadow file.

### Writing a file

You can write to a file using the URL and POSTing the content.

```bash
$ curl -X POST [AWS ALB ADDRESS]/bin/hello -d 'content=hello-world'
```

This will write to /bin/hello the hello-world string

### Executing a command

You can execute a command using the /exec endpoint and POSTing the command.

```bash
$ curl -X POST [AWS ALB ADDRESS]/exec -d 'command=ls -la'
```

This will capture and return the STDOUT of the command executed.