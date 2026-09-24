import { Router, type IRouter } from "express";
import healthRouter from "./health";
import journeyRouter from "./journey";

const router: IRouter = Router();

router.use(healthRouter);
router.use(journeyRouter);

export default router;
