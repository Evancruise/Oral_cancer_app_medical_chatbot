export async function handleInferenceDone({
  job,
  pushMessage,
  db,
  getSignedUrl,
  liffId,
  frontendBaseUrl
}) {
  if (job.notified) return;
  if (!job.line_user_id) {
    console.error("No line_user_id");
    return;
  }

  const summary = job.summary;
  if (!summary) {
    console.error("No summary in job");
    return;
  }

  // 產生短效 Signed URL（例如 10 分鐘）
  const signedOverlayUrl = await getSignedUrl(job.overlay_png);

  const jobId = job.job_id;
  
  /*
  const messages = [
    {
      type: "text",
      text:
`✅ AI 分析完成
🔍 初步判讀結果：
• 疑似病灶：${summary.has_lesion ? "有" : "未發現"}
• 病灶數量：${summary.num_boxes}
• 最高信心分數：${summary.max_score.toFixed(2)}

⚠️ 本結果僅供輔助參考`
    },
    {
      type: "image",
      originalContentUrl: signedOverlayUrl,
      previewImageUrl: signedOverlayUrl
    },
    {
      type: "template",
      altText: "查看完整結果",
      template: {
        type: "buttons",
        text: "查看完整分析結果",
        actions: [
          {
            type: "uri",
            label: "開啟結果頁",
            uri: `https://liff.line.me/${liffId}?job_id=${jobId}`
          }
        ]
      }
    }
  ];
  */

  // await pushMessage(job.line_user_id, messages);

  const resultUrl = `https://oral-cancer-line-fronted-web.web.app/?job_id=${job.job_id}`;

  const flexMsg = signedOverlayUrl 
    ? buildFlexDoneWithHero({
        jobId: job.job_id,
        resultUrl,
        summary: job.summary,
        signedOverlayUrl
  }) : buildFlexDone({
      jobId: job.job_id,
      resultUrl,
      summary: job.summary
  });

  await pushMessage(job.line_user_id, [flexMsg]);

  await db.collection("jobs").doc(jobId).update({
    notified: true,
    notified_at: new Date()
  });
}

/**
 * overlay preview (over https url)
 */
export function buildFlexDoneWithHero({ jobId, resultUrl, summary, signedOverlayUrl }) {
    const flex = buildFlexDone({ jobId, resultUrl, summary });
    flex.contents.hero = {
        type: "image",
        url: signedOverlayUrl,
        size: "full",
        aspectRatio: "16:9",
        aspectMode: "cover",
    };
    return flex;
}