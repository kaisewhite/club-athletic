# Club Athletic AWS infrastructure

Club Athletic's production web service runs in production account `736548610362`
(`mostrom_prod`) on the existing Edge production ECS cluster and HTTPS load
balancer in `us-east-1`. The management account owns the public hosted zone and
the manually managed public DNS records. It contains no Club Athletic app
service, load balancer, certificate, or app deployment pipeline.

The CDK stack creates the Club Athletic ECS service, task definition, roles,
security group, log group, and target group in the production account. It imports
the Edge VPC, ECS cluster, and HTTPS listener and adds the `meribel.xn--tshi-l3a.com`
host rule. The certificate and public DNS records are managed manually in the
management account. CDK creates no load balancer, ACM certificate, or Route 53
record; it only adds the Club Athletic host rule to the imported Edge listener.

Use the production profile for synthesis and deployment:

```sh
cd apps/aws
bun install
cdk synth --profile mostrom_prod
cdk deploy InfraStack --profile mostrom_prod --require-approval never
```

`cdk synth` with `mostrom_mgmt` is rejected. This CDK app creates no CodePipeline.

The existing Secrets Manager secret `club-athletic-web` supplies runtime
configuration. To update it from an environment file, run:

```sh
./scripts/push-secrets.sh web /path/to/production.env
```

The script defaults to `mostrom_prod`; set `AWS_PROFILE` only when intentionally
using another authorized profile.
