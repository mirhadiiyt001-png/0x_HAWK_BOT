import { Router, type IRouter } from "express";
import { fetchSmsCached as fetchSms } from "../lib/upstream";

const router: IRouter = Router();

router.get("/sms-stats", async (_req, res) => {
  try {
    const parsed = await fetchSms();
    const data = parsed.data as {
      iTotalRecords: string;
      iTotalDisplayRecords: string;
      aaData: unknown[][];
    };

    const allRows = data.aaData ?? [];

    // Filter out garbage/summary rows (phone must be a real number)
    const rows = allRows.filter((row) => {
      const arr = row as unknown[];
      const phone = String(arr[2] ?? "").trim();
      const body  = String(arr[7] ?? "").trim();
      return phone !== "0" && phone !== "" && body !== "0" && body !== "" && /\d{4,}/.test(phone);
    });

    // Count OTPs
    const otpKeywords = ["otp", "verification code", "verify", "code", "رمز", "کد", "pin", "auth", "passcode", "пароль", "код", "senha", "doğrulama"];
    let otpCount = 0;
    const recent = rows.slice(0, 10).map((row) => {
      const arr = row as unknown[];
      const body = String(arr[7] ?? "");
      const hasKeyword = otpKeywords.some((kw) => body.toLowerCase().includes(kw));
      const has6digit = /(?<!\d)\d{6}(?!\d)/.test(body);
      const isOtp = hasKeyword || has6digit;
      if (isOtp) otpCount++;
      return {
        timestamp: String(arr[0] ?? ""),
        sim: String(arr[1] ?? ""),
        phone: String(arr[2] ?? ""),
        device: String(arr[3] ?? ""),
        plan: String(arr[5] ?? ""),
        body,
        isOtp,
      };
    });

    res.json({
      totalRecords: data.iTotalRecords,
      totalDisplayed: data.iTotalDisplayRecords,
      otpCount,
      recent,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch SMS data" });
  }
});

export default router;
