import { Router, type IRouter } from "express";
import healthRouter from "./health";
import smsRouter from "./sms";
import proxyRouter from "./proxy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(smsRouter);
router.use(proxyRouter);

export default router;
