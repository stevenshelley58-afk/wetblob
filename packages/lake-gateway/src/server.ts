import Fastify from "fastify";
import { loadEnv } from "./env";
import { GatewayConfigSchema, configHash } from "./config";
import { createS3 } from "./s3";
import { registerHealth } from "./routes/health";
import { registerBlobs } from "./routes/blobs";
import { registerTasks } from "./routes/tasks";

async function main() {
  const env = loadEnv();

  const cfg = GatewayConfigSchema.parse({
    http: { port: env.GATEWAY_PORT },
    s3: { bucket: env.S3_BUCKET, prefix: env.S3_PREFIX }
  });

  const s3 = createS3(env);
  await s3.ensureBucket(cfg.s3.bucket);

  const app = Fastify({ logger: true });

  await registerHealth(app);
  await registerBlobs(app, { env, cfg, s3 });
  await registerTasks(app, { env });

  app.log.info({ config: { hash: configHash(cfg), ...cfg } }, "gateway_config");

  await app.listen({ port: cfg.http.port, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
