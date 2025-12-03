// server.js
import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();

app.use(express.json());
app.use(cors());

// 注意：不要把真正的 HitPaw API Key 写死在代码里
// 本地用 .env + dotenv，Render 上用 Dashboard 里的环境变量
const HITPAW_API_KEY = process.env.HITPAW_API_KEY;

if (!HITPAW_API_KEY) {
  console.warn("Warning: HITPAW_API_KEY is not set. Please configure environment variable.");
}

// 封装：创建图片增强任务
async function createEnhanceJob(imageUrl) {
  const resp = await fetch("https://api-base.niuxuezhang.cn/api/photo-enhancer", {
    method: "POST",
    headers: {
      "APIKEY": HITPAW_API_KEY,      // 文档要求 header 里带 APIKEY :contentReference[oaicite:3]{index=3}
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      img_url: imageUrl,
	  extension: ".jpg",
	  model_list: ["super_resolution_2x"],
	  upscale: 2,
	  exif: true,
	  DPI: 300
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HitPaw create job http error: ${resp.status} - ${text}`);
  }

  const data = await resp.json();
  if (data.code !== 200) {
    // 按官方返回格式，code=200 表示成功 :contentReference[oaicite:4]{index=4}
    throw new Error(`HitPaw create job failed: code=${data.code}, message=${data.message}`);
  }

  return data.data.job_id;
}

// 封装：查询任务结果
async function queryEnhanceResult(jobId) {
  const url = `https://api-base.niuxuezhang.cn/api/task-status?job_id=${encodeURIComponent(jobId)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ job_id: jobId })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HitPaw query status http error: ${resp.status} - ${text}`);
  }

  const data = await resp.json();
  return data;
}

// 给 ChatGPT / 其他客户端用的统一入口
app.post("/enhance-photo", async (req, res) => {
  try {
    const { image_url } = req.body;

    if (!image_url) {
      return res.status(400).json({ error: "image_url is required" });
    }
    if (!HITPAW_API_KEY) {
      return res.status(500).json({ error: "HITPAW_API_KEY not configured on server" });
    }

    // 1. 先创建任务，拿到 job_id
    const jobId = await createEnhanceJob(image_url);

    // 2. 轮询任务状态（简单版本）
    const maxAttempts = 20;       // 最多轮询 20 次
    const intervalMs = 5000;      // 每次间隔 3 秒
    let resultData = null;

    for (let i = 0; i < maxAttempts; i++) {
      // 等待 interval
      await new Promise((r) => setTimeout(r, intervalMs));

      const statusResp = await queryEnhanceResult(jobId);

	  const status = statusResp.data?.status;	
      if (status === "COMPLETED") {
        resultData = statusResp.data;
        break;
      }

      if (status === "FAILED" || status === "ERROR") {
        const msg = statusResp.message || "HitPaw task failed";
        throw new Error(msg);
      }
    }

    if (!resultData) {
      return res.status(504).json({
        error: "Enhance timeout, please try again later.",
        job_id: jobId
      });
    }

    // 明确返回增强后图片链接，方便 GPT / 前端直接用
    const enhancedUrl = resultData.res_url;
    const originalUrl = resultData.original_url;

    return res.json({
      code: 200,
      data: {
        job_id: jobId,
        status: resultData.status,
        enhanced_url: enhancedUrl,
        original_url: originalUrl
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// 健康检查
app.get("/", (req, res) => {
  res.send("HitPaw Photo Proxy is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
