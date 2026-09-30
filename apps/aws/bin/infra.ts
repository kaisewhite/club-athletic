#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { InfraStack } from "../lib/infra-stack";
import { project } from "../properties";

const app = new cdk.App();

cdk.Tags.of(app).add("Project", project.name);

if (
  process.env.AWS_PROFILE === "mostrom_mgmt"
  || (process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_ACCOUNT !== project.productionAccount)
) {
  throw new Error(`Club Athletic production infrastructure must use mostrom_prod / account ${project.productionAccount}`);
}

const environment = { account: project.productionAccount, region: project.region };
new InfraStack(app, "InfraStack", { env: environment });
