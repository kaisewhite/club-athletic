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
        "echo Building the Docker image...",
        `docker build --no-cache --platform linux/amd64 -t ${imageUri}:${imageTag} ${sourcePath}`,
      ],
    },
    post_build: {
      commands: [
        `docker push ${imageUri}:${imageTag} | tee /tmp/club-athletic-image-push.log`,
        "IMAGE_DIGEST=$(awk '/digest: sha256:/ { print $3 }' /tmp/club-athletic-image-push.log | tail -1)",
        "test -n \"$IMAGE_DIGEST\"",
        "test -n \"$CODEBUILD_RESOLVED_SOURCE_VERSION\"",
        `printf '{\"imageUri\":\"${imageUri}@%s\",\"sourceRevision\":\"%s\"}' \"$IMAGE_DIGEST\" \"$CODEBUILD_RESOLVED_SOURCE_VERSION\" > image-detail.json`,
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
      commands: ["curl -fsSL https://bun.sh/install | bash"],
    },
    pre_build: {
      commands: [`cd ${sourcePath} && $HOME/.bun/bin/bun install --frozen-lockfile --registry=https://registry.npmjs.org/`],
    },
    build: {
      commands: [
        `cd ${sourcePath} && $HOME/.bun/bin/bun run lint`,
        `cd ${sourcePath} && $HOME/.bun/bin/bun run test`,
        `cd ${sourcePath} && $HOME/.bun/bin/bun run build`,
      ],
    },
  },
});

interface DeploymentProps {
  readonly region: string;
  readonly cluster: string;
  readonly service: string;
  readonly healthUrl: string;
}

export const serviceDeploymentBuildSpec = ({ region, cluster, service, healthUrl }: DeploymentProps) => codebuild.BuildSpec.fromObject({
  version: "0.2",
  phases: {
    pre_build: {
      commands: [
        "test -s image-detail.json",
        "IMAGE_URI=$(jq -er '.imageUri' image-detail.json)",
        "SOURCE_REVISION=$(jq -er '.sourceRevision' image-detail.json)",
        "case \"$IMAGE_URI\" in *@sha256:*) ;; *) echo 'Build artifact lacks a pinned image digest' >&2; exit 1;; esac",
        "test -n \"$SOURCE_REVISION\"",
      ],
    },
    build: {
      commands: [
        `aws ecs update-service --cluster ${cluster} --service ${service} --force-new-deployment --region ${region}`,
        `aws ecs wait services-stable --cluster ${cluster} --services ${service} --region ${region}`,
        `curl --fail --silent --show-error --retry 15 --retry-delay 4 --retry-all-errors ${healthUrl}`,
        "echo \"Deployed $SOURCE_REVISION with $IMAGE_URI to the management account service\"",
      ],
    },
  },
});
