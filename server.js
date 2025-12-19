// server.js
import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors());

const HITPAW_API_KEY = process.env.HITPAW_API_KEY;

if (!HITPAW_API_KEY) {
  console.warn("Warning: HITPAW_API_KEY is not set. Please configure environment variable.");
}

async function createEnhanceJob(imageUrl) {
  const resp = await fetch("https://api-base.niuxuezhang.cn/api/photo-enhancer", {
    method: "POST",
    headers: {
      APIKEY: HITPAW_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      img_url: imageUrl,
      extension: ".jpg",
      model_list: ["super_resolution_2x"],
      upscale: 2,
      exif: true,
      DPI: 300,
    }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HitPaw create job http error: ${resp.status} - ${text}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HitPaw create job returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (data.code !== 200) {
    throw new Error(`HitPaw create job failed: code=${data.code}, message=${data.message}`);
  }

  const jobId = data?.data?.job_id;
  if (!jobId) {
    throw new Error(`HitPaw create job missing job_id. Response: ${text.slice(0, 300)}`);
  }

  return jobId;
}

async function queryEnhanceResult(jobId) {
  // ⚠️ 这里我保留 POST，但同时把 APIKEY 带上，并且只用一种传参方式（body）
  const resp = await fetch("https://api-base.niuxuezhang.cn/api/task-status", {
    method: "POST",
    headers: {
      APIKEY: HITPAW_API_KEY, // ✅ 很多服务查询也要 key
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HitPaw query status http error: ${resp.status} - ${text}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HitPaw query status returned non-JSON: ${text.slice(0, 200)}`);
  }

  return data;
}

// 统一入口
app.post("/enhance-photo", async (req, res) => {
  try {
    const { image_url } = req.body;

    if (!image_url) return res.status(400).json({ error: "image_url is required" });
    if (!HITPAW_API_KEY) return res.status(500).json({ error: "HITPAW_API_KEY not configured on server" });

    // 1) create job
    const jobId = await createEnhanceJob(image_url);

    // 2) poll status
    const maxAttempts = 20;
    const intervalMs = 5000;

    let lastStatusResp = null;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));

      const statusResp = await queryEnhanceResult(jobId);
      lastStatusResp = statusResp;

      // 兼容：有些接口 code!=200 也会返回 200 HTTP
      if (statusResp.code && statusResp.code !== 200) {
        throw new Error(`HitPaw status api failed: code=${statusResp.code}, message=${statusResp.message}`);
      }

      const status = statusResp?.data?.status;

      // ✅ 关键：把你收到的 status 打日志，方便排查
      console.log("poll", { jobId, attempt: i + 1, status, message: statusResp?.message });

      if (status === "COMPLETED") {
        const data = statusResp.data;

        // 字段兼容：你之前用 res_url / original_url，这里兼容更多可能
        const enhancedUrl = data.res_url || data.enhanced_url || data.result_url;
        const originalUrl = data.original_url || image_url;

        if (!enhancedUrl) {
          throw new Error(`COMPLETED but missing enhanced url. data=${JSON.stringify(data).slice(0, 300)}`);
        }

        return res.status(200).json({
          code: 200,
          data: {
            job_id: jobId,
            status,
            enhanced_url: enhancedUrl,
            original_url: originalUrl,
          },
        });
      }

      // ❗失败分支：不要用 message 作为唯一错误原因
      if (status === "FAILED" || status === "ERROR") {
        const detail =
          statusResp?.data?.error_message ||
          statusResp?.data?.fail_reason ||
          statusResp?.data?.detail ||
          statusResp?.message ||
          "HitPaw task failed";

        throw new Error(`HitPaw task ${status}: ${detail}`);
      }

      // 其它状态：PENDING / PROCESSING / RUNNING ... 继续等
    }

    // timeout: 把 last response 带回，方便你定位
    return res.status(504).json({
      error: "Enhance timeout, please try again later.",
      job_id: jobId,
      last: lastStatusResp ? JSON.stringify(lastStatusResp).slice(0, 800) : null,
    });
  } catch (err) {
    console.error(err);
    // 这里我建议 502 更贴近“上游服务失败”
    res.status(502).json({ error: err.message || "Upstream error" });
  }
});

// health
app.get("/", (req, res) => {
  res.send("HitPaw Photo Proxy is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
