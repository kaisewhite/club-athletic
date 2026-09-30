// The one stack this project deploys: the Club Athletic web service on Edge's
// production cluster and load balancer in account 736548610362.
//
// The constructs, ids and names are edge's (resources/stacks/shared/index.ts and
// resources/stacks/fargate/platform/fargate.ts), reduced to what one public web
// service needs. The production listener and load-balancer security group are
// imported from Edge's `prod-edge-*` exports; the existing cluster is imported by name.
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dotenv from "dotenv";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

import { addStandardTags } from "../helpers/tag_resources";
import { project } from "../properties";

dotenv.config();

// Account and region are selected by the production AWS profile. The service joins
// Edge's production VPC because a target group cannot reach across VPCs.
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in apps/aws/.env`);
  return value;
};

export class InfraStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    const { environment, service } = project;
    const account = required("CDK_DEFAULT_ACCOUNT");
    const region = required("CDK_DEFAULT_REGION");

    super(scope, id, {
      ...props,
      stackName: `${project.name}-${environment}-cdk`,
      env: { account, region },
      description: `Stack for ${project.name} in ${environment} environment`,
      terminationProtection: false,
    });
    cdk.Tags.of(this).add("Project", project.name);

    const constructorPrefix = `${project.name}-${environment}-${service.name}`;
    const resourceName = `${project.name}-${service.name}`;
    const sharedPrefix = `${project.sharedServices.environment}-${project.sharedServices.project}`;
    const hostName = `${service.subdomain}.${project.domain}`;
    const { containerPort, imageTag } = service;

    const taggingProps = {
      project: project.name,
      service: service.name,
      environment,
      prefix: constructorPrefix,
      customTags: { Stack: "fargate" },
    };
    addStandardTags(this, taggingProps);

    /************************************ ECR ************************************/

    const ecrRepository = new ecr.Repository(this, `${project.name}-${service.name}-ecr-repository`, {
      repositoryName: resourceName,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // Keep one image per tracked tag and one untagged image.
    ecrRepository.addLifecycleRule({ tagPrefixList: [imageTag], maxImageCount: 1 });
    ecrRepository.addLifecycleRule({ tagStatus: ecr.TagStatus.UNTAGGED, maxImageCount: 1 });
    addStandardTags(ecrRepository, taggingProps);

    /**************************** SHARED SERVICES (edge) **************************/

    const vpc = ec2.Vpc.fromLookup(this, `importing-${constructorPrefix}-vpc`, {
      isDefault: false,
      vpcId: project.vpcId,
    });

    const ecsCluster = ecs.Cluster.fromClusterAttributes(this, `import-${constructorPrefix}-fargate-cluster`, {
      clusterName: project.sharedServices.project,
      vpc,
      securityGroups: [],
    });

    /**************************** SECRET, ROLES, LOGS *****************************/

    const secrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      `${constructorPrefix}-secret-reference`,
      resourceName,
    );

    // A task role for the app and a separate execution role for the ECS agent
    // (image pull, secret injection, log writes), as edge's web service.
    const ecsTaskRole = new iam.Role(this, `${constructorPrefix}-ecs-task-role`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      roleName: `${resourceName}-ecs-task-role`,
    });
    addStandardTags(ecsTaskRole, taggingProps);

    const ecsExecutionRole = new iam.Role(this, `${constructorPrefix}-ecs-execution-role`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      roleName: `${resourceName}-ecs-execution-role`,
    });
    ecsExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken"],
      resources: ["*"],
    }));
    addStandardTags(ecsExecutionRole, taggingProps);

    secrets.grantRead(ecsExecutionRole);
    ecrRepository.grantPull(ecsExecutionRole);

    const logGroup = new logs.LogGroup(this, `${constructorPrefix}-log-group`, {
      logGroupName: `ecs/container/${project.name}/${environment}/${service.name}`,
      retention: logs.RetentionDays.THREE_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    addStandardTags(logGroup, taggingProps);
    logGroup.grantWrite(ecsExecutionRole);

    /********************************* FARGATE ************************************/

    const containerSecrets = service.secrets.reduce<Record<string, ecs.Secret>>((acc, name) => {
      acc[name] = ecs.Secret.fromSecretsManager(secrets, name);
      return acc;
    }, {});

    const fargateSecurityGroup = new ec2.SecurityGroup(this, `${constructorPrefix}-fargate-security-group`, {
      vpc,
      securityGroupName: resourceName,
      allowAllOutbound: true,
    });
    addStandardTags(fargateSecurityGroup, taggingProps);
    // The load balancer is in this VPC; nothing else needs the container port.
    fargateSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(containerPort), `Allow TCP Traffic for ${vpc.vpcId}`);

    this.taskDefinition = new ecs.FargateTaskDefinition(this, `${constructorPrefix}-fargate-task-definition`, {
      family: resourceName,
      executionRole: ecsExecutionRole,
      taskRole: ecsTaskRole,
      memoryLimitMiB: service.memoryLimitMiB,
      cpu: service.cpu,
    });
    addStandardTags(this.taskDefinition, taggingProps);

    this.taskDefinition.addContainer(`${constructorPrefix}-fargate-container`, {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepository, imageTag),
      memoryLimitMiB: service.memoryLimitMiB,
      cpu: service.cpu,
      containerName: constructorPrefix,
      versionConsistency: ecs.VersionConsistency.DISABLED,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "ecs",
        logGroup,
      }),
      portMappings: [
        {
          containerPort,
          protocol: ecs.Protocol.TCP,
          hostPort: containerPort,
        },
      ],
      secrets: containerSecrets,
      environment: {
        AWS_REGION: this.region,
        NODE_ENV: "production",
        PORT: `${containerPort}`,
      },
      ...(service.disableIpv6
        ? {
            systemControls: [
              { namespace: "net.ipv6.conf.all.disable_ipv6", value: "1" },
              { namespace: "net.ipv6.conf.default.disable_ipv6", value: "1" },
            ],
          }
        : {}),
    });

    this.service = new ecs.FargateService(this, `${constructorPrefix}-fargate-service`, {
      // Service names are unique per cluster, and this cluster is shared with edge.
      serviceName: resourceName,
      desiredCount: service.desiredCount,
      cluster: ecsCluster,
      deploymentController: { type: ecs.DeploymentControllerType.ECS },
      platformVersion: ecs.FargatePlatformVersion.LATEST,
      taskDefinition: this.taskDefinition,
      vpcSubnets: { subnets: vpc.privateSubnets },
      assignPublicIp: false,
      securityGroups: [fargateSecurityGroup],
      healthCheckGracePeriod: cdk.Duration.seconds(15),
      minHealthyPercent: 50,
      maxHealthyPercent: 200,
      circuitBreaker: {
        enable: true,
        rollback: true,
      },
      capacityProviderStrategies: [{ capacityProvider: service.capacityProvider, weight: 1 }],
    });
    addStandardTags(this.service, taggingProps);
    this.service.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    /****************************** LOAD BALANCER, DNS ****************************/

    const targetGroup = new elbv2.ApplicationTargetGroup(this, `${constructorPrefix}-target-group`, {
      vpc,
      port: containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: service.healthCheck,
        unhealthyThresholdCount: 2,
        healthyThresholdCount: 2,
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5),
      },
      targets: [this.service],
      targetGroupName: resourceName,
    });
    addStandardTags(targetGroup, taggingProps);

    const HTTPSListener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, `${sharedPrefix}-https-listener`, {
      listenerArn: cdk.Fn.importValue(`${sharedPrefix}-https-listener-arn`),
      securityGroup: ec2.SecurityGroup.fromSecurityGroupId(
        this,
        `imported-${constructorPrefix}-load-balancer-sg-id`,
        cdk.Fn.importValue(`${sharedPrefix}-load-balancer-sg-id`),
        {
          allowAllOutbound: true,
          mutable: true,
        },
      ),
    });

    HTTPSListener.addAction(`${constructorPrefix}-https-listener-action`, {
      priority: service.priority,
      conditions: [elbv2.ListenerCondition.hostHeaders([hostName])],
      action: elbv2.ListenerAction.forward([targetGroup]),
    });
    addStandardTags(HTTPSListener, taggingProps);

    // The public alias is created manually in the management account only after
    // the production service is healthy behind Edge's production ALB.
  }
}
