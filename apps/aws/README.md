# `apps/aws` — infrastructure for the Club Athletic trip app

One CDK stack, `club-athletic-prod-cdk`, deploying `apps/web` as a Fargate service
on edge's shared management-account cluster and load balancer. Standalone project:
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
| Secrets Manager secret | `club-athletic-web` (filled by `scripts/push-secrets.sh web ../web/.env`) |
| ECS task + execution roles | `club-athletic-web-ecs-task-role`, `club-athletic-web-ecs-execution-role` |
| Log group | `ecs/container/club-athletic/prod/web` |
| Fargate service | `club-athletic-web` on cluster `edge`, container `club-athletic-prod-web` |
| Target group + listener rule | `club-athletic-web`, priority 20 on edge's HTTPS listener |
| Route53 alias | `meribel.xn--tshi-l3a.com` → the shared load balancer |

Imported from edge's shared services (`mgmt-edge-*` exports): the cluster, the HTTPS
listener, and the load balancer's security group, DNS name and canonical zone.
Nothing here creates a load balancer or certificate. No Cloud Map, no EFS, no
peer-VPC ingress — one service, nothing calls it internally, nothing on disk.

## Deploy

```sh
bun install
bun run test                       # synth + naming smoke test
./scripts/deploy.sh                # cdk deploy, profile mostrom_mgmt
./scripts/push-secrets.sh web ../web/.env
# build + push the image to club-athletic-web:main, then force a new deployment
```
