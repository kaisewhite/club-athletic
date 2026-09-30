// Club Athletic production service on Edge's production cluster and ALB.
export const project = {
  name: "club-athletic",
  environment: "prod",
  productionAccount: "736548610362",
  region: "us-east-1",
  domain: "xn--tshi-l3a.com",
  clusterName: "edge",
  sharedServices: { project: "edge", environment: "prod" },
  vpcId: "vpc-00cf2fc1f07003d3b",
  service: {
    name: "web",
    resourceName: "club-athletic-web",
    description: "Club Athletic trip hub: React Router SSR app with the trip concierge agent",
    // The image is tagged by the branch it is built from; the push tag and the
    // task's pull tag must agree, or ECS pulls a tag that was never pushed.
    imageTag: "main",
    healthCheck: "/health",
    subdomain: "meribel",
    // Shared HTTPS listener priorities in use: 10 api, 11 app, 12 oracle, 100 health.
    priority: 20,
    desiredCount: 1,
    memoryLimitMiB: 1024,
    cpu: 512,
    // apps/web's Dockerfile follows edge's web-platform (PORT=4173). Behind the ALB the
    // public port is 443, so this is internal; non-privileged on purpose.
    containerPort: 4173,
    capacityProvider: "FARGATE",
    // The private subnets have IPv4-only egress and Neon is dual-stack, so an
    // IPv6-preferring client hangs at connect. Disable IPv6 in the task namespace.
    disableIpv6: true,
    // Key names only; values are pushed to the service secret by scripts/push-secrets.sh.
    secrets: [
      "ANTHROPIC_API_KEY",
      "DATABASE_URL",
      "DATABASE_URL_POOLED",
      "CLAUDE_MANAGED_ENVIRONMENT_ID",
      "CLAUDE_TRIP_AGENT_ID",
      "CLAUDE_TRIP_MEMORY_STORE_ID",
    ],
  },
} as const;
