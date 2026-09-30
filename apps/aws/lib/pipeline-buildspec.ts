import * as codebuild from "aws-cdk-lib/aws-codebuild";

interface ImageBuildProps {
  readonly imageUri: string;
  readonly imageTag: string;
  readonly region: string;
  readonly sourcePath: string;
}

export const imageBuildSpec = ({ imageUri, imageTag, region, sourcePath }: ImageBuildProps) => codebuild.BuildSpec.fromObject({
  version: "0.2",
  phases: {
    pre_build: {
      commands: [
        "echo Logging in to Amazon ECR...",
        `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${imageUri.split("/")[0]}`,
      ],
    },
    build: {
      commands: [
        "echo Building the application image...",
        `docker build --platform linux/amd64 -t ${imageUri}:${imageTag} ${sourcePath}`,
      ],
    },
    post_build: {
      commands: [
        `docker push ${imageUri}:${imageTag} | tee /tmp/club-athletic-image-push.log`,
        "IMAGE_DIGEST=$(awk '/digest: sha256:/ { print $3 }' /tmp/club-athletic-image-push.log | tail -1)",
        "test -n \"$IMAGE_DIGEST\"",
        "test -n \"$CODEBUILD_RESOLVED_SOURCE_VERSION\"",
        `printf '{"imageUri":"${imageUri}@%s","sourceRevision":"%s"}' "$IMAGE_DIGEST" "$CODEBUILD_RESOLVED_SOURCE_VERSION" > image-detail.json`,
      ],
    },
  },
  artifacts: { files: ["image-detail.json"] },
});

export const testBuildSpec = (sourcePath: string) => codebuild.BuildSpec.fromObject({
  version: "0.2",
  phases: {
    install: {
      "runtime-versions": { nodejs: "22" },
      commands: [
        "curl -fsSL https://bun.sh/install | bash",
        `$HOME/.bun/bin/bun install --cwd ${sourcePath} --frozen-lockfile --registry=https://registry.npmjs.org/`,
        `cd ${sourcePath} && $HOME/.bun/bin/bunx playwright install --with-deps chromium`,
      ],
    },
    build: {
      commands: [[
        // CodeBuild's default command shell is /bin/sh, so use POSIX options.
        "set -eu",
        `cd "$CODEBUILD_SRC_DIR/${sourcePath}"`,
        "export PATH=\"$HOME/.bun/bin:$PATH\"",
        "aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws",
        "docker run --detach --name club-athletic-e2e-postgres --env POSTGRES_USER=clubathletic --env POSTGRES_PASSWORD=e2e-only-password --env POSTGRES_DB=club_athletic_test --publish 5432:5432 public.ecr.aws/docker/library/postgres:16-alpine",
        "cleanup() { docker rm --force club-athletic-e2e-postgres >/dev/null 2>&1 || true; }",
        "trap cleanup EXIT",
        "for attempt in $(seq 1 30); do if docker exec club-athletic-e2e-postgres pg_isready --username clubathletic --dbname club_athletic_test; then break; fi; sleep 1; done",
        "docker exec club-athletic-e2e-postgres pg_isready --username clubathletic --dbname club_athletic_test",
        "export CLUB_ATHLETIC_WEB_ENV_FILE=/tmp/club-athletic-e2e.env",
        "cat > \"$CLUB_ATHLETIC_WEB_ENV_FILE\" <<'EOF'",
        "ANTHROPIC_API_KEY=local-mocked-provider-key",
        "DATABASE_URL=postgresql://clubathletic:e2e-only-password@127.0.0.1:5432/club_athletic_test?sslmode=disable",
        "DATABASE_URL_POOLED=postgresql://clubathletic:e2e-only-password@127.0.0.1:5432/club_athletic_test?sslmode=disable",
        "PORT=47317",
        "EOF",
        "bash scripts/with-env.sh \"$HOME/.bun/bin/bunx\" prisma migrate deploy",
        "bash scripts/with-env.sh \"$HOME/.bun/bin/bun\" prisma/seed.ts",
        "bash scripts/with-env.sh \"$HOME/.bun/bin/bun\" run lint",
        "bash scripts/with-env.sh \"$HOME/.bun/bin/bun\" run test",
        "bash scripts/with-env.sh env CLUB_ATHLETIC_E2E_REPORTS=true \"$HOME/.bun/bin/bunx\" playwright test tests/visual/local-chat.spec.ts tests/visual/mobile-layout.spec.ts tests/visual/mobile-tables.spec.ts --project=desktop-1280",
      ].join("\n")],
    },
    post_build: {
      commands: [
        "mkdir -p playwright-report test-results",
        "printf 'End-to-end build status: %s\\n' \"${CODEBUILD_BUILD_SUCCEEDING:-unknown}\" > playwright-report/codebuild-status.txt",
        "printf 'End-to-end build status: %s\\n' \"${CODEBUILD_BUILD_SUCCEEDING:-unknown}\" > test-results/codebuild-status.txt",
      ],
    },
  },
  artifacts: {
    "base-directory": sourcePath,
    files: ["playwright-report/**/*", "test-results/**/*"],
    "discard-paths": false,
  },
});

interface DeploymentProps {
  readonly region: string;
  readonly cluster: string;
  readonly service: string;
  readonly containerName: string;
  readonly loadBalancerName: string;
  readonly hostName: string;
  readonly hostedZoneId: string;
  readonly healthPath: string;
}

export const serviceDeploymentBuildSpec = ({
  region,
  cluster,
  service,
  containerName,
  loadBalancerName,
  hostName,
  hostedZoneId,
  healthPath,
}: DeploymentProps) => codebuild.BuildSpec.fromObject({
  version: "0.2",
  phases: {
    pre_build: {
      commands: [
        "test -s image-detail.json",
        "IMAGE_URI=$(jq -er '.imageUri' image-detail.json)",
        "SOURCE_REVISION=$(jq -er '.sourceRevision' image-detail.json)",
        "case \"$IMAGE_URI\" in *@sha256:*) ;; *) echo 'Build artifact lacks an immutable image digest' >&2; exit 1;; esac",
        "test -n \"$SOURCE_REVISION\"",
      ],
    },
    build: {
      commands: [[
        "set -euo pipefail",
        `SERVICE_JSON=$(aws ecs describe-services --cluster ${cluster} --services ${service} --region ${region} --output json)`,
        "CURRENT_TASK_DEFINITION=$(echo \"$SERVICE_JSON\" | jq -er '.services[0].taskDefinition')",
        `aws ecs describe-task-definition --task-definition "$CURRENT_TASK_DEFINITION" --region ${region} --query taskDefinition --output json > /tmp/club-athletic-current-task.json`,
        `jq -e --arg container ${containerName} 'any(.containerDefinitions[]; .name == $container)' /tmp/club-athletic-current-task.json >/dev/null`,
        `jq --arg image "$IMAGE_URI" --arg container ${containerName} 'del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy) | .containerDefinitions |= map(if .name == $container then .image = $image else . end)' /tmp/club-athletic-current-task.json > /tmp/club-athletic-next-task.json`,
        `NEW_TASK_DEFINITION=$(aws ecs register-task-definition --cli-input-json file:///tmp/club-athletic-next-task.json --region ${region} --query 'taskDefinition.taskDefinitionArn' --output text)`,
        `aws ecs update-service --cluster ${cluster} --service ${service} --task-definition "$NEW_TASK_DEFINITION" --region ${region}`,
        `aws ecs wait services-stable --cluster ${cluster} --services ${service} --region ${region}`,
        `ALB_JSON=$(aws elbv2 describe-load-balancers --names ${loadBalancerName} --region ${region} --output json)`,
        "ALB_DNS=$(echo \"$ALB_JSON\" | jq -er '.LoadBalancers[0].DNSName')",
        "ALB_ZONE_ID=$(echo \"$ALB_JSON\" | jq -er '.LoadBalancers[0].CanonicalHostedZoneId')",
        `case "$ALB_DNS" in *.${region}.elb.amazonaws.com) ;; *) echo 'Management load balancer lookup returned an invalid DNS name' >&2; exit 1;; esac`,
        `curl --noproxy '*' --fail --silent --show-error --connect-timeout 10 --max-time 30 --retry 15 --retry-delay 4 --retry-all-errors --connect-to '${hostName}:443:'"$ALB_DNS"':443' 'https://${hostName}${healthPath}'`,
        `ALIAS_CHANGE=$(jq -n --arg name '${hostName}.' --arg dns "$ALB_DNS." --arg zone "$ALB_ZONE_ID" '{Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:$name,Type:"A",AliasTarget:{HostedZoneId:$zone,DNSName:$dns,EvaluateTargetHealth:false}}}]}')`,
        `CHANGE_ID=$(aws route53 change-resource-record-sets --hosted-zone-id ${hostedZoneId} --change-batch "$ALIAS_CHANGE" --query 'ChangeInfo.Id' --output text)`,
        "aws route53 wait resource-record-sets-changed --id \"$CHANGE_ID\"",
        `curl --noproxy '*' --fail --silent --show-error --connect-timeout 10 --max-time 30 --retry 15 --retry-delay 4 --retry-all-errors --connect-to '${hostName}:443:'"$ALB_DNS"':443' 'https://${hostName}${healthPath}'`,
        `echo "Deployed $SOURCE_REVISION with $IMAGE_URI to management service ${service}"`,
      ].join("\n")],
    },
  },
});
