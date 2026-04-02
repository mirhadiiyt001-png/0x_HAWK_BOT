import { Router, type IRouter } from "express";
import healthRouter from "./health";
import smsRouter from "./sms";

const router: IRouter = Router();

router.use(healthRouter);
router.use(smsRouter);

export default router;
