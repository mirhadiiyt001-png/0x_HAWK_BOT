import { Router, type IRouter } from "express";

const router: IRouter = Router();

const API_URL = "https://mis-panel-production.up.railway.app/api/bhadi?type=sms";

router.get("/sms-stats", async (req, res) => {
  try {
    const upstream = await fetch(API_URL);
    const raw = await upstream.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(raw);
    const data = JSON.parse(text) as {
      iTotalRecords: string;
      iTotalDisplayRecords: string;
      aaData: unknown[][];
      sEcho: number;
    };

    const rows = data.aaData ?? [];

    // Count OTPs
    const otpKeywords = ["otp", "verification code", "verify", "code", "رمز", "کد", "pin", "auth", "passcode"];
    let otpCount = 0;
    const recent = rows.slice(0, 10).map((row) => {
      const arr = row as unknown[];
      const body = String(arr[7] ?? "");
      const isOtp = otpKeywords.some((kw) => body.toLowerCase().includes(kw));
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
