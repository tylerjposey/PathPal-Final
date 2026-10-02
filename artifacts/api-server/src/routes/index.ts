import { Router, type IRouter } from "express";
import healthRouter from "./health";
import journeyRouter from "./journey";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(journeyRouter);
router.use(reportsRouter);

export default router;
