# Club Athletic AWS infrastructure

Club Athletic runs entirely in management AWS account `366394957699` (`mostrom_mgmt`) in `us-east-1`. Its infrastructure is named and tagged for the `mgmt` environment; no separate production or development account stacks are part of this CDK app.

## Resources

| Resource | Configuration |
|---|---|
| ECS cluster | `club-athletic` |
| ECS service | `web` |
| ECR repository | `club-athletic-web` (existing management repository) |
| Secrets Manager | `club-athletic-web` (existing management secret) |
| DNS | `meribel.xn--tshi-l3a.com`, hosted zone configured in `properties/index.ts` |
| HTTPS listener | Club Athletic's own ALB and ACM certificate in management |
| CodePipeline | `club-athletic-web`, GitHub `kaisewhite/club-athletic` `main` branch |

The infrastructure stack creates the Club Athletic cluster and web service, task and execution roles, security groups, target group, and internet-facing load balancer. It imports the existing matching ACM certificate by ARN and uses the existing `/ecs/club-athletic-web` log group, management ECR repository, runtime secret, management VPC, and hosted zone. The pipeline has Source, Build, EndToEnd, and Deploy stages, all within management; it has no cross-account roles or dev/prod stages. The target group's `/health` check is the service health check; there is no separate container health check.

## Pipeline setup and deployment

The management CodePipeline is the only routine application deployment path. Once the management infrastructure and pipeline have been bootstrapped, pushes to `main` start the pipeline. The Docker build publishes an immutable image digest. The EndToEnd action uses a disposable loopback PostgreSQL container and mocked AI provider to run lint, unit tests, and local browser acceptance checks; it does not need application secrets or contact the live AI provider. Runtime credentials are read by ECS from the existing Secrets Manager secret, not exposed to CodeBuild. Only after EndToEnd passes does Deploy update the management ECS service to the image digest, wait for ECS stability, check `/health` directly against the management ALB, and then update the hosted-zone alias. Pipeline executions are queued so an older build cannot race a newer one.

The first-time bootstrap is performed with explicit CDK CLI commands from `apps/aws`, after confirming `AWS_PROFILE=mostrom_mgmt` resolves to account `366394957699`:

```sh
cdk synth --profile mostrom_mgmt && cdk deploy --profile mostrom_mgmt --all --require-approval never
```

Do not use `npm run build` or run a TypeScript emit build in this directory; use CDK synth and diff. After the initial bootstrap, deploy application changes by pushing to `main`, not with a manual image deployment script. Runtime configuration is read from the existing `club-athletic-web` secret. `scripts/push-secrets.sh` updates that secret when runtime values change. If a future CodeBuild step needs a real secret, expose only the required secret keys with CodeBuild's Secrets Manager environment variable type, following the Edge pipeline pattern.
