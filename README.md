# Example of ECS Fargate using the CDK that works with Sysdig Secure

This is an example of using the [CDK's ECS Patterns construct](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns-readme.html) in TypeScript in a way that will work with Sysdig's Fargate support.

I am going to add a Python example to this soon as well.

It is intended as an example to inspire you on how to change your own CDK so that Sysdig can transform/instrument it like it does with CloudFormation. It can also be useful as a way to test Fargate support within your Sysdig environment is working as it deploys [Sysdig's Security Playground](https://github.com/sysdiglabs/security-playground) to help facilitate triggering Events in Sysdig's Runtime Threat Detection feature(s).

The way that Sysdig's Fargate support works is that:
1. A sidecar container is added to each Task. 2. Then, your container is changed to mount theirs as a Volume
3. Then your entrypoint and commands are changed such that their service is run first and then it, in turns, run yours
3. Finally SYS_PTRACE is added - which Sysdig leverage in a special more efficient/peformant way to get visibility into the runtime activity of the container via a tool called pdig described in detail in this blog post - https://sysdig.com/blog/aws-fargate-runtime-security-ptrace-ld_preload/.

There are two CDK files - `bin/cdk.ts` which instatiates the stacks and `lib/cdk-stacks.ts` which is where most of the CDK code actually lives.

NOTE: This is not a supported thing from Sysdig (as Sysdig supports CloudFormation and Terraform) - but instead is an example I prepared on how to get CDK to generate the CloudFormation that, in turn, would be supported. Sysdig will help as long as your CDK generates the required/'right' CloudFormation - but it will be best effort in their helping you with CDK to get it go generate that CloudFormation as required. If you have support from AWS then should support the CDK to get you to that point.

## Usage

### Prerequisites
1. Install node.js if required (using Homebrew or the OS pacakage repository such as apt, yum or dnf etc.)

### Install the CDK Stacks
1. First run `npm install` in this folder
2. Then prepare to deploy by editing `cdk.json`. There you can configure the following parameters:
* account - The AWS account to deploy to
* region - The AWS region to deploy to
* public_load_balancer - do you want the service to be on the Internet (NOTE: this service is highly insecure so consider leaving it public)
* sysdig_etc_shadow_healthcheck - do you want this service to be healthchecked in a way that will trigger Sysdig events (by retrievig sensitive file /etc/shadow)
* SYSDIG_ACCESS_KEY - the access key for your Sysdig instance the Orchestrator stack will use to authenticate
* SYSDIG_COLLECTOR - the address for your Sysdig backend (usually your Sysdig SaaS region) for the collector to talk to
* SYSDIG_COLLECTOR_PORT - the port of the Sysdig backend (usually your Sysdig SaaS region) for the collector to talk to
3. Run `npx cdk deploy FargateSecurityPlaygroundStack --require-approval never` which will deploy all the stacks (they depend on each other all the way up to FargateSecurityPlaygroundStack)

### How to trigger Sysdig Events once deployed

This example deploys [Sysdig's Security Playground](https://github.com/sysdiglabs/security-playground) which is a insecure Python service that will allow you to read, write and execute things within the container via curl. 

NOTE: I highly suggest not putting this service's load balancer on the Internet, and instead interacting with it within your private VPC, as it is insecure by design in order to test Sysdig's Runtime Threat Detection is working as you'd expect with CDK and Fargate.

### Reading a file

You can read a file using just the URL.

```bash
$ curl [AWS ALB ADDRESS]/etc/shadow
```

This will return the content of the /etc/shadow file.

NOTE: If you flip the sysdig_etc_shadow_healthcheck option in cdk.json then we change the ALB healthcheck to do this every 5 minutes automatically for you.

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