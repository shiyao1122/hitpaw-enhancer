// server.js
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// 从环境变量读取 HitPaw API Key
const HITPAW_API_KEY = process.env.HITPAW_API_KEY;

async function createEnhanceJob(imageUrl, format = ".png") {
  const resp = await fetch("https://api.hitpaw.com/api/v3/photoEnhanceByUrl", {
    method: "POST",
    headers: {
      "APIKEY": HITPAW_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image_url: imageUrl,
      image_format: format
    })
  });

  const data = await resp.json();
  if (data.code !== 200) {
    throw new Error(`HitPaw create job failed: ${data.message}`);
  }
  return data.data.job_id;
}

async function queryEnhanceResult(jobId) {
  const url = `https://api.hitpaw.com/api/v3/photo-enhance/status?job_id=${jobId}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ job_id: jobId })
  });

  const data = await resp.json();
  return data;
}

// 对外的中转接口：一次调用搞定
app.post("/enhance-photo", async (req, res) => {
  try {
    const { image_url, image_format = ".png" } = req.body;
    if (!image_url) {
      return res.status(400).json({ error: "image_url is required" });
    }

    // 1. 创建任务
    const jobId = await createEnhanceJob(image_url, image_format);

    // 2. 轮询任务状态（简单粗暴版）
    let result = null;
    const maxAttempts = 20;
    const intervalMs = 3000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, intervalMs));
      const status = await queryEnhanceResult(jobId);

      // 这里需要根据 HitPaw 实际返回结构判断任务成功
      // 假设 status.data.status === "success" 时成功
      if (status.data && status.data.status === "success") {
        result = status.data;
        break;
      }

      if (status.data && status.data.status === "failed") {
        throw new Error(status.data.message || "HitPaw task failed");
      }
    }

    if (!result) {
      return res.status(504).json({ error: "Enhance timeout" });
    }

    // 假设增强后图片地址在 result.output_url（字段名按实际返回改）
    return res.json({
      code: 200,
      data: {
        job_id: jobId,
        result: result
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
