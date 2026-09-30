import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import { addStandardTags } from "../helpers/tag_resources";
import { project } from "../properties";

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, { ...props, stackName: "InfraStack", description: "Club Athletic web app in the management account" });
    if (this.account !== project.managementAccount) throw new Error(`Club Athletic must deploy to management account ${project.managementAccount}`);

    const service = project.service;
    const hostName = `${service.subdomain}.${project.domain}`;
    const prefix = `${project.name}-${service.name}`;
    addStandardTags(this, { project: project.name, service: service.name, environment: project.environment });

    const vpc = ec2.Vpc.fromLookup(this, "ManagementVpc", { vpcId: project.vpcId });
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "ManagementHostedZone", {
      hostedZoneId: project.hostedZoneId,
      zoneName: project.domain,
    });
    const certificate = new acm.Certificate(this, "WebCertificate", {
      domainName: hostName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: project.clusterName, containerInsights: true });
    const albSecurityGroup = new ec2.SecurityGroup(this, "LoadBalancerSecurityGroup", { vpc, allowAllOutbound: true, description: "Public web traffic" });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP redirect");
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS web traffic");
    const serviceSecurityGroup = new ec2.SecurityGroup(this, "ServiceSecurityGroup", { vpc, allowAllOutbound: true, description: "Club Athletic web tasks" });
    serviceSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(service.containerPort), "Traffic from load balancer");

    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetGroupName: "Public" },
      loadBalancerName: `${project.name}-web`,
      ipAddressType: elbv2 IpAddressType.IPV4,
    });
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "WebTargetGroup", {
      vpc,
      port: service.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: service.healthCheck, healthyHttpCodes: "200", interval: cdk.Duration.seconds(30) },
    });
    loadBalancer.addListener("HttpsListener", { port: 443, protocol: elbv2.ApplicationProtocol.HTTPS, certificates: [certificate], defaultTargetGroups: [targetGroup], open: true });
    loadBalancer.addListener("HttpListener", { port: 80, protocol: elbv2.ApplicationProtocol.HTTP, defaultAction: elbv2.ListenerAction.redirect({ protocol: "HTTPS", port: "443", permanent: true }), open: true });

    const executionRole = new iam.Role(this, "ExecutionRole", { assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"), managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")] });
    const secret = ecs.Secret.fromSecretsManager(ecs.Secret.fromSecretsManager as never);
