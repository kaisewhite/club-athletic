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
      description: `Build and deploy ${project.service.name} in the management account`,
    });

    if (this.account !== project.managementAccount || this.region !== project.pipeline.region) {
      throw new Error(`Pipeline must use management account ${project.managementAccount} in ${project.pipeline.region}`);
    }

    const serviceName = project.service.name;
    const resourceName = `${project.name}-${serviceName}`;
    const constructorPrefix = `${project.name}-${project.environment}-${serviceName}-pipeline`;
    const imageUri = `${this.account}.dkr.ecr.${project.region}.amazonaws.com/${resourceName}`;
    const serviceArn = `arn:aws:ecs:${project.region}:${this.account}:service/${project.clusterName}/${serviceName}`;

    const taggingProps = {
      project: project.name,
      service: serviceName,
      environment: project.environment,
      prefix: constructorPrefix,
      customTags: { Stack: "pipeline" },
    };
    addStandardTags(this, taggingProps);

    const pipelineRole = new iam.Role(this, `${constructorPrefix}-codepipeline-role`, {
      assumedBy: new iam.ServicePrincipal("codepipeline.amazonaws.com"),
      roleName: `${resourceName}-pipeline-role`,
    });
    pipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ["codestar-connections:UseConnection"],
      resources: [project.pipeline.connectionArn],
    }));

    const imageBuildRole = new iam.Role(this, `${constructorPrefix}-image-build-role`, {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      roleName: `${resourceName}-image-build-role`,
    });
    imageBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken"],
      resources: ["*"],
    }));
    imageBuildRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeImages",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart",
      ],
      resources: [`arn:aws:ecr:${project.region}:${this.account}:repository/${resourceName}`],
    }));

    const testRole = new iam.Role(this, `${constructorPrefix}-test-role`, {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      roleName: `${resourceName}-test-role`,
    });

    const deployRole = new iam.Role(this, `${constructorPrefix}-deploy-role`, {
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
      roleName: `${resourceName}-deploy-role`,
    });
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecs:DescribeServices", "ecs:UpdateService"],
      resources: [serviceArn],
    }));

    const buildLogGroup = new logs.LogGroup(this, `${constructorPrefix}-build-log-group`, {
      logGroupName: `/aws/codebuild/${resourceName}-build`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const testLogGroup = new logs.LogGroup(this, `${constructorPrefix}-test-log-group`, {
      logGroupName: `/aws/codebuild/${resourceName}-test`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const deployLogGroup = new logs.LogGroup(this, `${constructorPrefix}-deploy-log-group`, {
      logGroupName: `/aws/codebuild/${resourceName}-deploy`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const buildProject = new codebuild.Project(this, `${constructorPrefix}-build-project`, {
      projectName: `${resourceName}-build`,
      role: imageBuildRole,
      description: `Build and push ${resourceName}`,
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM, codebuild.LocalCacheMode.DOCKER_LAYER),
      buildSpec: imageBuildSpec({
        imageUri,
        imageTag: project.service.imageTag,
        region: project.region,
        sourcePath: "apps/web",
      }),
      environment: {
        computeType: codebuild.ComputeType.MEDIUM,
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
      },
      logging: { cloudWatch: { logGroup: buildLogGroup } },
      timeout: cdk.Duration.minutes(30),
      badge: false,
    });

    const testProject = new codebuild.Project(this, `${constructorPrefix}-test-project`, {
      projectName: `${resourceName}-test`,
      role: testRole,
      description: `Lint, test, and build ${resourceName}`,
      buildSpec: testBuildSpec("apps/web"),
      environment: {
        computeType: codebuild.ComputeType.MEDIUM,
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
      logging: { cloudWatch: { logGroup: testLogGroup } },
      timeout: cdk.Duration.minutes(30),
      badge: false,
    });

    const deployProject = new codebuild.Project(this, `${constructorPrefix}-deploy-project`, {
      projectName: `${resourceName}-deploy`,
      role: deployRole,
      description: `Deploy ${resourceName} to the management account`,
      buildSpec: serviceDeploymentBuildSpec({
        region: project.region,
        cluster: project.clusterName,
        service: serviceName,
        healthUrl: `https://${project.service.subdomain}.${project.domain}${project.service.healthCheck}`,
      }),
      environment: {
        computeType: codebuild.ComputeType.SMALL,
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
      },
      logging: { cloudWatch: { logGroup: deployLogGroup } },
      timeout: cdk.Duration.minutes(15),
      badge: false,
    });

    pipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ["codebuild:BatchGetBuilds", "codebuild:StartBuild", "codebuild:StopBuild"],
      resources: [buildProject.projectArn, testProject.projectArn, deployProject.projectArn],
    }));

    const sourceArtifact = new codepipeline.Artifact();
    const imageArtifact = new codepipeline.Artifact();
    const pipeline = new codepipeline.Pipeline(this, `${constructorPrefix}-pipeline`, {
      pipelineName: resourceName,
      pipelineType: codepipeline.PipelineType.V2,
      executionMode: codepipeline.ExecutionMode.QUEUED,
      role: pipelineRole,
      restartExecutionOnUpdate: true,
    });
    addStandardTags(pipeline, taggingProps);

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
      actions: [
        new actions.CodeBuildAction({
          actionName: "Docker",
          project: buildProject,
          input: sourceArtifact,
          outputs: [imageArtifact],
          ...actionRoleProps,
        }),
        new actions.CodeBuildAction({
          actionName: "Test",
          project: testProject,
          input: sourceArtifact,
          ...actionRoleProps,
        }),
      ],
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
