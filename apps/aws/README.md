# Club Athletic AWS infrastructure

Club Athletic runs entirely in management AWS account `366394957699` (`mostrom_mgmt`) in `us-east-1`. The workload is labeled `prod` because it serves the trip website; it is not deployed into a separate production or development account.

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

The infrastructure stack creates the Club Athletic cluster and web service, its task and execution roles, security groups, log group, target group, internet-facing load balancer, DNS-validated certificate, and DNS alias. It imports only the management VPC and existing management ECR repository and secret. The pipeline has Source, Build (Docker and tests), and Deploy stages, all within management; it has no cross-account roles or dev/prod stages.

## Pipeline setup and deployment

The management CodePipeline is the only routine application deployment path. Once the management infrastructure and pipeline have been bootstrapped, pushes to `main` start the pipeline. The Docker build publishes the image, the test action runs lint/tests/application build, and the deploy action updates the management ECS service and checks its health endpoint. Pipeline executions are queued so an older build cannot race a newer one.

The first-time bootstrap is performed with explicit CDK CLI commands from `apps/aws`, after confirming `AWS_PROFILE=mostrom_mgmt` resolves to account `366394957699`:

```sh
cdk synth --profile mostrom_mgmt && cdk deploy --profile mostrom_mgmt --all --require-approval never
```

Do not use `npm run build` or run a TypeScript emit build in this directory; use CDK synth and diff. After the initial bootstrap, deploy application changes by pushing to `main`, not with a manual image deployment script. Runtime configuration is read from the existing `club-athletic-web` secret. `scripts/push-secrets.sh` updates that secret when runtime values change.
