#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as dotenv from "dotenv";
import { InfraStack } from "../lib/infra-stack";
import { project } from "../properties";

dotenv.config();
const app = new cdk.App();

cdk.Tags.of(app).add("Project", project.name);

new InfraStack(app, "InfraStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  tags: {
    Project: project.name,
  },
});
