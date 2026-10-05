import { Router, type IRouter } from "express";
import healthRouter from "./health";
import journeyRouter from "./journey";
import familiesRouter from "./families";
import trackingRouter from "./tracking";
import reportsRouter from "./reports";
import sosRouter from "./sos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(journeyRouter);
router.use(reportsRouter);
router.use(sosRouter);
router.use(familiesRouter);
router.use(trackingRouter);

export default router;
