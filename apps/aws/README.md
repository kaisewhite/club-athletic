# `apps/aws` — infrastructure for the Club Athletic trip app

One CDK stack, `club-athletic-prod-cdk`, deploying `apps/web` as a Fargate service
on Edge's shared production cluster and load balancer in account `736548610362`. Standalone project:
its own `package.json`, `bun.lock`, `node_modules`, `tsconfig.json` and `.env`.

The constructs, construct ids and resource names are edge's
(`edge/apps/infrastructure/aws/resources/stacks/{shared,fargate/platform}`). edge
splits them across devops, shared and fargate stacks because it deploys many apps;
this is one app, so the same resources live in one stack — `lib/infra-stack.ts` —
and CloudFormation orders them by dependency.

## Layout

| Path | Role |
|---|---|
| `bin/infra.ts` | CDK entry point, as edge's |
| `lib/infra-stack.ts` | the stack |
| `properties/index.ts` | project + service properties, edge's shape; one environment, `prod` |
| `helpers/` | edge's `environment.ts` and `tag_resources`, verbatim |
| `scripts/deploy.sh`, `scripts/push-secrets.sh` | edge's scripts, project name changed |

## What the stack creates

| Resource | Name |
|---|---|
| ECR repository | `club-athletic-web` |
| Secrets Manager secret | `club-athletic-web` (created without a placeholder value; populate from `apps/web/.env` using the secure secret workflow) |
| ECS task + execution roles | `club-athletic-web-ecs-task-role`, `club-athletic-web-ecs-execution-role` |
| Log group | `ecs/container/club-athletic/prod/web` |
| Fargate service | `club-athletic-web` on cluster `edge`, container `club-athletic-prod-web` |
| Target group + listener rule | `club-athletic-web`, priority 20 on edge's HTTPS listener |
| Public DNS | No Route 53 record is created by this stack. Create the `meribel.xn--tshi-l3a.com` alias manually in the management account after the service is healthy. |

Imported from edge's production shared services (`prod-edge-*` exports): the HTTPS
listener and load-balancer security group. The existing ECS cluster is imported by
its name, `edge`, and the VPC is `vpc-00cf2fc1f07003d3b`. Nothing here creates a
load balancer or certificate. No Cloud Map, no EFS, no peer-VPC ingress — one
service, nothing calls it internally, nothing on disk.

## Deploy

```sh
bun install
./scripts/deploy.sh                # cdk deploy to account 736548610362, profile mostrom_prod
AWS_PROFILE=mostrom_prod ./scripts/push-secrets.sh web ../web/.env
../web/scripts/deploy-local.sh prod
```

Before the first service deployment, provision the production secret with the app's
real values. The CDK stack creates it without a placeholder. Then deploy `main` to
the production ECR repository. After the production service is healthy, create
the public alias in the management account, then remove the old management-account
service. Do not create that alias through CDK.
