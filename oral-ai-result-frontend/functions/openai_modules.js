import OpenAI from "openai";

/**
 * 調用 OpenAI 獲取 AI 回應
 * 當需要搜尋資料時，會自動使用 web_search tool
 */
export async function getAIResponse(openai, userMessage) {
    // 設定台灣的地理位置資訊（用於 web_search）
    const userLocation = {
        type: "approximate",
        country: "TW",
        city: "Taipei",
        region: "Taiwan",
        timezone: "Asia/Taipei"
    };

    // 友善、幽默的提示詞
    const instructions = `你是一個友善、幽默的 LINE AI 聊天機器人助手。你的特點是：
- 回覆要親切、溫暖，就像跟朋友聊天一樣
- 適度使用幽默感，讓對話更有趣（但不要太過頭）
- 使用繁體中文回覆
- 回答要簡潔明瞭，不要過於冗長
- 如果使用者問到需要最新資訊的問題（如：天氣、新聞、股價、時事等），你會自動使用網路搜尋功能來獲取最新資料
- 保持輕鬆愉快的對話氛圍`;

    const response = await openai.responses.create({
        model: "gpt-4.1-mini",
        instructions: instructions,
        tools: [
            { 
                type: "web_search",
                user_location: userLocation
            },
        ],
        input: [
            {
                role: "user",
                content: userMessage
            }
        ],
        include: [
            "web_search_call.action.sources"
        ],
        // 控制回覆的創意度和長度
        temperature: 0.7, // 中等創意，適合友善幽默的對話
        max_output_tokens: 1000, // 限制回覆長度，保持簡潔
    });

    // 檢查是否有使用網路搜尋
    const hasWebSearch = response.output?.some(o => o.type === "web_search_call");
    if (hasWebSearch) {
        console.log("已使用網路搜尋功能");
        const webSearchCall = response.output?.find(o => o.type === "web_search_call");
        if (webSearchCall?.action?.sources) {
            console.log("搜尋來源數量:", webSearchCall.action.sources.length);
        }
    }

    return response.output_text;
}