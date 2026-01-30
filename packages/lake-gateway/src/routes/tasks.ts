import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createDb, enqueueTask, leaseNextTask, markTaskSucceeded, markTaskFailed } from "@wetblob/lake-db";
import type { Env } from "../env";

export async function registerTasks(app: FastifyInstance, deps: { env: Env }) {
  const db = createDb(deps.env.DATABASE_URL);

  app.post("/v1/tasks/enqueue", async (req, reply) => {
    const Schema = z.object({
      type: z.string().min(1),
      payload: z.any(),
      dueAt: z.string().optional(),
      priority: z.number().int().optional(),
      runId: z.string().optional()
    });

    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid_body", issues: parsed.error.issues };
    }

    const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined;

    const task = await enqueueTask(db, {
      type: parsed.data.type,
      payload: parsed.data.payload,
      dueAt,
      priority: parsed.data.priority ?? 0,
      runId: parsed.data.runId ?? undefined
    });

    return { task };
  });

  app.post("/v1/tasks/lease", async (req, reply) => {
    const Schema = z.object({
      workerId: z.string().min(1),
      leaseMs: z.number().int().positive().default(30000)
    });

    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid_body", issues: parsed.error.issues };
    }

    const task = await leaseNextTask(db, { workerId: parsed.data.workerId, leaseMs: parsed.data.leaseMs });
    return { task: task ?? null };
  });

  app.post("/v1/tasks/:taskId/succeed", async (req) => {
    const taskId = (req.params as any).taskId as string;
    await markTaskSucceeded(db, taskId);
    return { ok: true };
  });

  app.post("/v1/tasks/:taskId/fail", async (req, reply) => {
    const Schema = z.object({ error: z.string().min(1) });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "invalid_body", issues: parsed.error.issues };
    }

    const taskId = (req.params as any).taskId as string;
    await markTaskFailed(db, taskId, parsed.data.error);
    return { ok: true };
  });
}
