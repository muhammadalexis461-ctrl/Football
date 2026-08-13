import { Router, type IRouter } from "express";
import { WorkerHealthCheckResponse } from "@workspace/api-zod";
import { getWorkerHealth } from "../worker/job-queue";

const router: IRouter = Router();

router.get("/worker/healthz", async (_req, res): Promise<void> => {
  const health = await getWorkerHealth();
  res.json(WorkerHealthCheckResponse.parse(health));
});

export default router;