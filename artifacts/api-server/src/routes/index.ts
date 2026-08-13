import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workerRouter from "./worker";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workerRouter);

export default router;
