import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";

import { addStandardTags } from "../helpers/tag_resources";
import { project } from "../properties";
import { imageBuildSpec, serviceDeploymentBuildSpec, testBuildSpec } from "./pipeline-buildspec";

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      stackName: `${project.name}-${project.service.name}-pipeline`,
      description: `Build, test and deploy ${project.service.name} in the management account`,
    });

    if (this.account !== project.managementAccount || this.region !== project.pipeline.region) {
      throw new Error(`Pipeline must use management account ${project.managementAccount} in ${project.pipeline.region}`);
    }

    const { service } = project;
    const resourceName = service.resourceName;
    const constructorPrefix = `${project.name}-${service.name}-pipeline`;
    const imageUri = `${this.account}.dkr.ecr.${project.region}.amazonaws.com/${resourceName}`;
    const serviceArn = `arn:aws:ecs:${project.region}:${this.account}:service/${project.clusterName}/${service.name}`;
    const hostedZoneArn = `arn:aws:route53:::hostedzone/${project.hostedZoneId}`;
    const executionRoleArn = `arn:aws:iam::${this.account}:role/${resourceName}-execution-role`;
    const taskRoleArn = `arn:aws:iam::${this.account}:role/${resourceName}-task-role`;

    const tags = {
      project: project.name,
      service: service.name,
      environment: project.environment,
      prefix: constructorPrefix,
      customTags: { Stack: "pipeline" },
    };
    addStandardTags(this, tags);

    const pipelineRole = new iam.Role(this, "PipelineRole", {
      roleName: `${resourceName}-pipeline-role`,
      assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com"),
    });
    pipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ["codeconnections:UseConnection", "codestar-connections:UseConnection"],
      resources: [project.pipeline.connectionArn],
    }));

    const imageBuildRole = new iam.Role(this, "ImageBuildRole", {
      roleName: `${resourceName}-image-build-role`,
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
    });
    imageBuildRole.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
    imageBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:DescribeImages", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"],
      resources: [`arn:aws:ecr:${project.region}:${this.account}:repository/${resourceName}`],
    }));

    const testRole = new iam.Role(this, "EndToEndRole", {
      roleName: `${resourceName}-e2e-role`,
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
    });
    testRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr-public:GetAuthorizationToken"],
      resources: ["*"],
    }));
    testRole.addToPolicy(new iam.PolicyStatement({
      actions: ["sts:GetServiceBearerToken"],
      resources: ["*"],
    }));

    const deployRole = new iam.Role(this, "DeployRole", {
      roleName: `${resourceName}-deploy-role`,
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
    });
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecs:DescribeServices", "ecs:UpdateService"],
      resources: [serviceArn],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"],
      resources: ["*"],
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [executionRoleArn, taskRoleArn],
      conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
    }));
    deployRole.addToPolicy(new iam.PolicyStatement({ actions: ["elasticloadbalancing:DescribeLoadBalancers"], resources: ["*"] }));
    deployRole.addToPolicy(new iam.PolicyStatement({ actions: ["route53:ChangeResourceRecordSets"], resources: [hostedZoneArn] }));
    deployRole.addToPolicy(new iam.PolicyStatement({ actions: ["route53:GetChange"], resources: ["*"] }));

    const buildLogGroup = new logs.LogGroup(this, "BuildLogGroup", {
      logGroupName: `/aws/codebuild/${resourceName}-build`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const e2eLogGroup = new logs.LogGroup(this, "EndToEndLogGroup", {
      logGroupName: `/aws/codebuild/${resourceName}-e2e`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const deployLogGroup = new logs.LogGroup(this, "DeployLogGroup", {
      logGroupName: `/aws/codebuild/${resourceName}-deploy`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    for (const [role, logGroup] of [[imageBuildRole, buildLogGroup], [testRole, e2eLogGroup], [deployRole, deployLogGroup]] as const) {
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${logGroup.logGroupArn}:*`],
      }));
    }

    const buildProject = new codebuild.Project(this, "ImageBuildProject", {
      projectName: `${resourceName}-build`,
      role: imageBuildRole,
      description: `Build and publish ${resourceName}`,
      buildSpec: imageBuildSpec({ imageUri, imageTag: service.imageTag, region: project.region, sourcePath: "apps/web" }),
      environment: {
        computeType: codebuild.ComputeType.MEDIUM,
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
      logging: { cloudWatch: { logGroup: buildLogGroup } },
      timeout: cdk.Duration.minutes(30),
      badge: false,
    });
    const e2eProject = new codebuild.Project(this, "EndToEndProject", {
      projectName: `${resourceName}-e2e`,
      role: testRole,
      description: "Run isolated local database and browser acceptance checks",
      buildSpec: testBuildSpec("apps/web"),
      environment: {
        computeType: codebuild.ComputeType.MEDIUM,
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
      logging: { cloudWatch: { logGroup: e2eLogGroup } },
      timeout: cdk.Duration.minutes(30),
      badge: false,
    });
    const deployProject = new codebuild.Project(this, "ManagementDeployProject", {
      projectName: `${resourceName}-deploy`,
      role: deployRole,
      description: `Deploy ${resourceName} to management ECS`,
      buildSpec: serviceDeploymentBuildSpec({
        region: project.region,
        cluster: project.clusterName,
        service: service.name,
        containerName: service.name,
        loadBalancerName: resourceName,
        hostName: `${service.subdomain}.${project.domain}`,
        hostedZoneId: project.hostedZoneId,
        healthPath: service.healthCheck,
      }),
      environment: {
        computeType: codebuild.ComputeType.SMALL,
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
      logging: { cloudWatch: { logGroup: deployLogGroup } },
      timeout: cdk.Duration.minutes(30),
      badge: false,
    });

    pipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ["codebuild:BatchGetBuilds", "codebuild:StartBuild", "codebuild:StopBuild"],
      resources: [buildProject.projectArn, e2eProject.projectArn, deployProject.projectArn],
    }));
    pipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [imageBuildRole.roleArn, testRole.roleArn, deployRole.roleArn],
      conditions: { StringEquals: { "iam:PassedToService": "codebuild.amazonaws.com" } },
    }));

    const sourceArtifact = new codepipeline.Artifact("Source");
    const imageArtifact = new codepipeline.Artifact("Image");
    const reportArtifact = new codepipeline.Artifact("EndToEndReports");
    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: resourceName,
      pipelineType: codepipeline.PipelineType.V2,
      executionMode: codepipeline.ExecutionMode.QUEUED,
      role: pipelineRole,
      restartExecutionOnUpdate: true,
    });
    addStandardTags(pipeline, tags);

    const actionRoleProps = { role: pipelineRole };
    pipeline.addStage({
      stageName: "Source",
      actions: [new actions.CodeStarConnectionsSourceAction({
        actionName: "GitHub",
        owner: project.pipeline.githubOwner,
        repo: project.pipeline.githubRepository,
        branch: project.pipeline.branch,
        connectionArn: project.pipeline.connectionArn,
        output: sourceArtifact,
        triggerOnPush: true,
        ...actionRoleProps,
      })],
    });
    pipeline.addStage({
      stageName: "Build",
      actions: [new actions.CodeBuildAction({
        actionName: "Docker",
        project: buildProject,
        input: sourceArtifact,
        outputs: [imageArtifact],
        ...actionRoleProps,
      })],
    });
    pipeline.addStage({
      stageName: "EndToEnd",
      actions: [new actions.CodeBuildAction({
        actionName: "BrowserAcceptance",
        project: e2eProject,
        input: sourceArtifact,
        outputs: [reportArtifact],
        ...actionRoleProps,
      })],
    });
    pipeline.addStage({
      stageName: "Deploy",
      actions: [new actions.CodeBuildAction({
        actionName: "Management",
        project: deployProject,
        input: imageArtifact,
        ...actionRoleProps,
      })],
    });
  }
}
