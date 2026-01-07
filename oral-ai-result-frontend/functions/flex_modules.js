/**
 * 分析中 Flex Message
 */
export function buildFlexProcessing({ jobId, resultUrl }) {
    return {
        type: "flex",
        altText: "AI 分析中",
        contents: {
            type: "bubble",
            size: "mega",
            body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                contents: [
                    {
                        type: "text",
                        text: "AI 分析中",
                        weight: "bold",
                        size: "xl",
                    },
                    {
                        type: "text",
                        text: "已收到影像，系統正在進行辨識 (bbox + seg)。完成後將自動通知你。",
                        wrap: true,
                        size: "sm",
                        color: "#666666",
                    },
                    {
                        type: "separator",
                    },
                    {
                        type: "box",
                        layout: "vertical",
                        spacing: "sm",
                        contents: [
                            {
                                type: "text",
                                text: "Case ID",
                                size: "sm",
                                color: "#999999",
                            },
                            {
                                type: "text",
                                text: jobId,
                                size: "sm",
                                wrap: true,
                            },
                        ],
                    },
                ],
            },
            footer: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                contents: [
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "uri",
                            label: "開啟結果頁 (稍後刷新)",
                            uri: resultUrl,
                        },
                    },
                    {
                        type: "text",
                        text: "結果僅供輔助參考，仍需由醫師判讀。",
                        wrap: true,
                        size: "xs",
                        color: "#999999",
                    },
                ],
            },
        },
    };
}

/**
 * 分析完成 Flex Message
 */
export function buildFlexDone({ jobId, resultUrl, summary }) {
    const hasLesionText = summary?.has_lesion ? "有" : "未發現";
    const numBoxes = summary?.num_boxes ?? 0; //////////////////////////////
    const maxScore = typeof summary?.max_score === "number"
    ? summary.max_score.toFixed(2) : "N/A";

    return {
        type: "flex",
        altText: "AI 分析完成",
        contents: {
            type: "bubble",
            size: "mega",
            body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                contents: [
                    {
                        type: "text",
                        text: "AI 分析完成",
                        weight: "bold",
                        size: "xl",
                    },
                    {
                        type: "text",
                        text: "初步判讀摘要如下 (bbox + seg 產出):",
                        wrap: true,
                        size: "sm",
                        color: "#666666",
                    },
                    {
                        type: "separator",
                    },
                    {
                        type: "box",
                        layout: "vertical",
                        spacing: "sm",
                        contents: [
                            buildKeyValue("疑似病灶", hasLesionText),
                            buildKeyValue("病灶數量", String(numBoxes)),
                            buildKeyValue("最高信心分數", String(maxScore)),
                        ],
                    },
                    {
                        type: "separator",
                    },
                    {
                        type: "box",
                        layout: "vertical",
                        spacing: "xs",
                        contents: [
                            {
                                type: "text",
                                text: "Case ID",
                                size: "xs",
                                color: "#999999",
                            },
                            {
                                type: "text",
                                text: jobId,
                                size: "xs",
                                wrap: true,
                            },
                        ],
                    },
                ],
            },
            footer: {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                contents: [
                    {
                        type: "button",
                        style: "primary",
                        action: {
                            type: "uri",
                            label: "開啟完整結果 (建議)",
                            uri: resultUrl,
                        },
                    },
                    {
                        type: "text",
                        text: "本結果僅供輔助參考，仍須由醫師判讀。",
                        wrap: true,
                        size: "xs",
                        color: "#999999",
                    },
                ],
            },
        },
    };
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

function buildKeyValue(k, v) {
    return {
        type: "box",
        layout: "baseline",
        contents: [
            { type: "text", text: k, size: "sm", color: "#555555", flex: 4 },
            { type: "text", text: v, size: "sm", color: "#111111", flex: 2, align: "end" },
        ],
    };
}