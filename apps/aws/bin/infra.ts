#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { InfraStack } from "../lib/infra-stack";
import { PipelineStack } from "../lib/pipeline-stack";
import { project } from "../properties";

const app = new cdk.App();

cdk.Tags.of(app).add("Project", project.name);

if (process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_ACCOUNT !== project.managementAccount) {
  throw new Error(`Club Athletic infrastructure must use management account ${project.managementAccount}`);
}

const managementEnvironment = { account: project.managementAccount, region: project.region };
new InfraStack(app, "InfraStack", { env: managementEnvironment });
new PipelineStack(app, "PipelineStack", { env: { account: project.managementAccount, region: project.pipeline.region } });
