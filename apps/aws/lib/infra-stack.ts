import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

import { addStandardTags } from "../helpers/tag_resources";
import { project } from "../properties";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      stackName: `${project.name}-${project.environment}-${project.service.name}-fargate`,
      description: "Club Athletic web service in the management account",
    });

    const { service } = project;
    const constructorPrefix = `${project.name}-${project.environment}-${service.name}`;
    const hostName = `${service.subdomain}.${project.domain}`;
    const resourceName = service.resourceName;
    addStandardTags(this, {
      project: project.name,
      service: service.name,
      environment: project.environment,
    });

    const vpc = ec2.Vpc.fromLookup(this, `${constructorPrefix}-vpc`, { vpcId: project.vpcId });
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      `${constructorPrefix}-certificate`,
      project.certificate.certificateArn[project.environment],
    );

    const cluster = new ecs.Cluster(this, `${constructorPrefix}-ecs-cluster`, {
      vpc,
      clusterName: project.clusterName,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const runtimeSecret = secretsmanager.Secret.fromSecretNameV2(this, `${constructorPrefix}-runtime-secret`, resourceName);
    const repository = ecr.Repository.fromRepositoryName(this, `${constructorPrefix}-ecr-repository`, resourceName);
    const executionRole = new iam.Role(this, `${constructorPrefix}-ecs-execution-role`, {
      roleName: `${resourceName}-execution-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
      ],
    });
    runtimeSecret.grantRead(executionRole);
    repository.grantPull(executionRole);
    const taskRole = new iam.Role(this, `${constructorPrefix}-ecs-task-role`, {
      roleName: `${resourceName}-task-role`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    const taskDefinition = new ecs.FargateTaskDefinition(this, `${constructorPrefix}-fargate-task-definition`, {
      cpu: service.cpu,
      memoryLimitMiB: service.memoryLimitMiB,
      executionRole,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const taskLogGroup = logs.LogGroup.fromLogGroupName(this, `${constructorPrefix}-log-group`, `/ecs/${resourceName}`);
    taskLogGroup.grantWrite(executionRole);
    const containerSecrets: Record<string, ecs.Secret> = {};
    for (const key of service.secrets) {
      containerSecrets[key] = ecs.Secret.fromSecretsManager(runtimeSecret, key);
    }
    taskDefinition.addContainer(`${constructorPrefix}-container`, {
      containerName: service.name,
      image: ecs.ContainerImage.fromEcrRepository(repository, service.imageTag),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: service.name, logGroup: taskLogGroup }),
      secrets: containerSecrets,
      portMappings: [{ containerPort: service.containerPort, protocol: ecs.Protocol.TCP }],
      ...(service.disableIpv6
        ? {
            systemControls: [
              { namespace: "net.ipv6.conf.all.disable_ipv6", value: "1" },
              { namespace: "net.ipv6.conf.default.disable_ipv6", value: "1" },
            ],
          }
        : {}),
    });

    const loadBalancerSecurityGroup = new ec2.SecurityGroup(this, `${constructorPrefix}-load-balancer-security-group`, {
      vpc,
      description: "Public HTTPS for Club Athletic",
      allowAllOutbound: true,
    });
    loadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP redirect");
    loadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS web traffic");
    const serviceSecurityGroup = new ec2.SecurityGroup(this, `${constructorPrefix}-service-security-group`, {
      vpc,
      description: "Club Athletic web tasks",
      allowAllOutbound: true,
    });
    serviceSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(service.containerPort),
      "Traffic from the load balancer",
    );

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, `${constructorPrefix}-load-balancer`, {
      vpc,
      internetFacing: true,
      securityGroup: loadBalancerSecurityGroup,
      vpcSubnets: { subnetGroupName: "Public" },
      loadBalancerName: resourceName,
      ipAddressType: elbv2.IpAddressType.IPV4,
    });
    const webService = new ecs.FargateService(this, `${constructorPrefix}-fargate-service`, {
      cluster,
      serviceName: service.name,
      taskDefinition,
      desiredCount: service.desiredCount,
      assignPublicIp: true,
      securityGroups: [serviceSecurityGroup],
      vpcSubnets: { subnetGroupName: "Public" },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      capacityProviderStrategies: [{ capacityProvider: service.capacityProvider, weight: 1 }],
    });
    const targetGroup = new elbv2.ApplicationTargetGroup(this, `${constructorPrefix}-target-group`, {
      vpc,
      port: service.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: service.healthCheck,
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
      },
    });
    targetGroup.addTarget(webService);

    loadBalancer.addListener(`${constructorPrefix}-https-listener`, {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      defaultTargetGroups: [targetGroup],
      open: false,
    });
    loadBalancer.addListener(`${constructorPrefix}-http-listener`, {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }),
      open: false,
    });

    new cdk.CfnOutput(this, `${constructorPrefix}-load-balancer-name`, { value: loadBalancer.loadBalancerName });
    new cdk.CfnOutput(this, `${constructorPrefix}-load-balancer-dns-name`, { value: loadBalancer.loadBalancerDnsName });
  }
}
