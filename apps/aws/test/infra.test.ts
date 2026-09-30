// One stack, edge's names. edge's own suite proves the constructs; this only guards
// that the app synthesizes and is named as expected.
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { InfraStack } from "../lib/infra-stack";

test("the app is one stack that synthesizes with edge's naming", () => {
  process.env.CDK_DEFAULT_ACCOUNT = "366394957699";
  process.env.CDK_DEFAULT_REGION = "us-east-1";
  process.env.MGMT_VPC = "vpc-01386cc23ddfbbb97";
  const app = new cdk.App();
  const stack = new InfraStack(app, "InfraStack");
  expect(app.synth().stacks.map((s) => s.stackName)).toEqual(["club-athletic-prod-cdk"]);
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::ECS::Service", { ServiceName: "club-athletic-web", Cluster: "edge" });
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", { Priority: 20 });
  template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
});
