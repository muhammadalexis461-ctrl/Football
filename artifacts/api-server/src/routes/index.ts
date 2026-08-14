import { Router, type IRouter } from "express";
import footballRouter from "./football";
import healthRouter from "./health";
import workerRouter from "./worker";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(footballRouter);
router.use(workerRouter);
router.use(dashboardRouter);

export default router;
