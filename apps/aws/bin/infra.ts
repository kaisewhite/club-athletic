#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { InfraStack } from "../lib/infra-stack";
import { PipelineStack } from "../lib/pipeline-stack";
import { project } from "../properties";

const app = new cdk.App();

cdk.Tags.of(app).add("Project", project.name);

const managementEnvironment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const infrastructureStack = new InfraStack(app, `${project.name}-mgmt-${project.service.name}-fargate`, {
  env: managementEnvironment,
});
const pipelineStack = new PipelineStack(app, `${project.name}-${project.service.name}-pipeline`, {
  env: managementEnvironment,
});
pipelineStack.node.addDependency(infrastructureStack);
