import { Router, type IRouter } from "express";
import { fetchSmsCached } from "../lib/upstream";

const router: IRouter = Router();

router.get("/sms-stats", async (_req, res) => {
  try {
    const data = await fetchSmsCached();
    const records = data.records ?? [];

    // Count OTPs
    const otpKeywords = ["otp", "verification code", "verify", "code", "رمز", "کد", "pin", "auth", "passcode", "пароль", "код", "senha", "doğrulama"];
    let otpCount = 0;
    const recent = records.slice(0, 10).map((rec) => {
      const body = rec.message || "";
      const hasKeyword = otpKeywords.some((kw) => body.toLowerCase().includes(kw));
      const has6digit = /(?<!\d)\d{6}(?!\d)/.test(body);
      const isOtp = hasKeyword || has6digit;
      if (isOtp) otpCount++;
      return {
        timestamp: rec.date,
        sim: rec.termination,
        phone: rec.number,
        device: rec.cli,
        plan: rec.payterm,
        body,
        isOtp,
      };
    });

    res.json({
      totalRecords: String(data.total),
      totalDisplayed: String(records.length),
      otpCount,
      recent,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch SMS data" });
  }
});

export default router;
