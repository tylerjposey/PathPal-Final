import { Router, type IRouter } from "express";
import healthRouter from "./health";
import journeyRouter from "./journey";
import reportsRouter from "./reports";
import accountsRouter from "./accounts";
import reportMapRouter from "./report-map";
import familyJourneysRouter from "./family-journeys";

const router: IRouter = Router();

router.use(healthRouter);
router.use(journeyRouter);
router.use(accountsRouter);
router.use(familyJourneysRouter);
router.use(reportsRouter);
router.use(reportMapRouter);

export default router;
