import crypto from "node:crypto";
import { z } from "zod";

export const GatewayConfigSchema = z.object({
  http: z.object({
    port: z.number().int().positive()
  }),
  s3: z.object({
    bucket: z.string().min(1),
    prefix: z.string().min(1)
  })
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export function configHash(cfg: GatewayConfig) {
  return crypto.createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 12);
}
