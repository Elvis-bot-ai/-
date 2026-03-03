import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { ReportData, AnalysisType } from "../types";

// Note: In a real production app, never expose keys on client. 
// However, per instructions, we rely on process.env.API_KEY.
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please set process.env.API_KEY.");
  }
  return new GoogleGenAI({ apiKey });
};

const FALLBACK_MODEL = 'gemini-3-flash-preview';

// Helper to format date as requested: 1月12日, GMT+8 16:29:45
const getFormattedDate = () => {
  const now = new Date();
  const dateOptions: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' };
  const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' };
  
  const dateStr = now.toLocaleDateString('zh-CN', dateOptions);
  const timeStr = now.toLocaleTimeString('zh-CN', timeOptions);
  
  return `${dateStr}, GMT+8 ${timeStr}`;
};

// Helper to handle API retries for 503, 429 and 500 errors
const generateContentWithRetry = async (
  ai: GoogleGenAI, 
  params: any, 
  maxRetries = 3, 
  baseDelay = 2000
): Promise<GenerateContentResponse> => {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // @ts-ignore - The params type definition might be strict, but passing the object works
      return await ai.models.generateContent(params);
    } catch (error: any) {
      lastError = error;
      
      // Extract status and message safely
      // The error structure can vary between SDK versions and response types
      const status = error?.status || error?.response?.status;
      const code = error?.code || error?.error?.code;
      const rawMessage = error?.message || error?.error?.message || (typeof error === 'string' ? error : JSON.stringify(error));

      // Check for Hard Quota Limit (Daily Quota or Billing)
      // "You exceeded your current quota" indicates a hard stop, not a transient rate limit.
      const isQuotaHardLimit = 
        rawMessage.includes("exceeded your current quota") || 
        rawMessage.includes("check your plan") || 
        rawMessage.includes("billing") ||
        (status === 429 && rawMessage.includes("RESOURCE_EXHAUSTED"));

      if (isQuotaHardLimit) {
        throw new Error("API调用失败：配额已耗尽 (Quota Exceeded)。请检查您的Google Cloud Billing状态或更换API Key。");
      }

      // Check for Retryable Errors: 
      // 503 (Service Unavailable), 429 (Rate Limit - RPM/TPM), 500 (Internal Error)
      const isRetryable = 
        status === 503 || 
        code === 503 || 
        rawMessage.includes('503') ||
        rawMessage.includes('UNAVAILABLE') ||
        status === 429 || 
        code === 429 ||
        rawMessage.includes('429') ||
        status === 500 || 
        code === 500 ||
        rawMessage.includes('500') ||
        rawMessage.includes('INTERNAL') ||
        rawMessage.includes('Internal error');

      if (isRetryable && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Gemini API Error (${status || code}). Retrying in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  throw lastError;
};

// Default models, but can be overridden
const DEFAULT_REASONING = 'gemini-3-pro-preview';

const SYSTEM_INSTRUCTION = `
角色：拥有20年经验的亚洲区“QFII/RQFII 投资总监”，以操作私募基金主力闻名。
风格：专业、客观、中立、犀利、数据驱动。

**最高优先级指令：数据实时性 (Real-time Precision)**
1. **必须使用 Google Search** 获取**今日(Today)** 的最新交易数据。
2. **严禁使用 T-1 (昨日) 数据**：如果当前系统时间显示市场处于交易时段（如A股 9:30-15:00），必须找到分钟级的实时报价。如果搜索结果只有昨日收盘价，必须明确标注“数据滞后”。
3. **时间戳比对规则**：
   - 获取数据时，必须检查数据来源的时间戳。
   - 保留与“当前系统时间”误差最小的数据（Time Delta Minimized）。
   - 如果多个来源价格差异超过 20%，优先采信雪球(Xueqiu)或Google Finance中更新时间最近的那个。

**AlphaQuant 评分体系 (核心更新)**
满分100分。请AI自动基于以下加减分项计算最终得分（初始分60分）：

**【加分项 (每触发一项 +2~5分)】**
- **趋势强劲**：T+1涨停概率>70%；处于明确上涨趋势；连板且属热门板块；90天内异动/涨停>5次；向上空间打开。
- **资金/机构**：主力资金持续流入；多家机构评级“买入”；外资/QFII重仓；长期优质持有。
- **基本面/政策**：符合中国政策发展方向；业绩支撑强；行业地位高；有护城河。
- **消息/热点**：最新重大利好/成果；与实时热点关联度高；处于风口；消息面利多。

**【减分项 (每触发一项 -2~5分)】**
- **趋势走坏**：T+1做空几率>50%；近期见顶信号；下跌趋势；技术破位；向上空间低。
- **资金/筹码**：主力资金明显流出；杠杆资金拥挤；获利盘多；主力有多信号明显。
- **基本面/风险**：年度持续亏损；估值过高；监管预警。
- **环境**：与市场主线脱节；消息面利空；长期卖出评级。

**一票否决**：若数据严重滞后（非今日实时），评分强制扣除 20 分。

职责：
1. **深度研报**：严格执行13步分析法（包含开盘预测、量化策略、股票实估价、价值评估与资金指标分析）。
2. **数据校验**：确保数据实时准确。
3. **评分落地**：必须在报告末尾列出“AlphaQuant 评分详情”。
`;

export const generateStockReport = async (
  query: string, 
  modelId: string = DEFAULT_REASONING,
  history: any[] = []
): Promise<string> => {
  const ai = getAiClient();
  const reportDate = getFormattedDate();

  const prompt = `
  请针对"${query}"生成一份专业的QFII级别投资分析报告。
  **当前系统精准时间**：${reportDate}。
  
  **Step 0: 搜索执行 (Chain of Thought - Real-time Check)**
  你必须先调用 Google Search 查询，**务必寻找“今日”和“最新”的数据，拒绝旧数据**：
  1. "${query} 股票价格 今日分时 site:xueqiu.com" (强制获取今日实时行情)
  2. "${query} stock price quote site:google.com/finance" (Google Finance)
  3. "${query} 股票 最新价 东方财富网" (辅助验证)
  4. "${query} 今日 盘中异动" 
  5. "${query} 财务指标 市盈率 毛利率"
  6. "今日A股 热门板块 涨幅榜 前十"
  
  **数据筛选逻辑 (Internal Logic)**:
  - 检查搜索结果中的时间。
  - 必须找到 **今日** 的数据。若无法找到今日数据，请在报告开头大写加粗提示：**[⚠️ 警告：未检索到今日实时交易数据]**。

  **报告生成内容要求（按顺序输出 Markdown）：**

  **1. 基础信息与双源校验 (Time Sensitive)**
  - **官方实时行情跳转**：
    - 格式：\`### [👉 点击查看 ${query} 实时行情 (官网)](URL)\`
    - 优先使用 Google Finance 或 雪球 的个股详情页URL。
    - **安全兜底**：若无确切URL，使用 \`https://www.google.com/finance?q=${query}\`。
  - **实时数据展示 (Crucial)**：
    - **最新价格**：[价格] (涨跌幅)
    - **数据时间**：[MM-DD HH:MM] **<-- 必须精确写出你获取的数据的具体时间**
    - **状态判定**：
      - 如果 数据时间 == 今日 && 误差 < 1小时 -> **[🟢 实时/盘中]**
      - 如果 数据时间 != 今日 -> **[🔴 滞后/已收盘]** (请检查是否休市)
  - 列出 **雪球** 和 **Google Finance** 的对比价格。

  **2. 关键财务指标与行业对比**
  - 提取关键指标（PE-TTM、EPS、毛利率、ROE）。
  - **必须**与该股票所在行业的平均水平进行对比。

  **3. 异常波动与新闻溯源**
  - 识别近期股价是否存在异常波动。
  - 结合搜索到的新闻，解释波动背后的原因。

  **4. 健康状况诊断**
  - 评级：**优 / 良 / 中 / 差**。
  - 简述理由。

  **5. 周期价格预测表 (核心)**
  - 绘制预测表格：
  | 周期 | 预测价格区间 | 上涨/下跌概率 | 核心分析逻辑 |
  | :--- | :--- | :--- | :--- |
  | **T+1 (明日)** | ... | ... | ... |
  | **T+3 (短线)** | ... | ... | ... |
  | **1个月 (中线)** | ... | ... | ... |
  | **90天 (长线)** | ... | ... | ... |

  **6. 市场热点与板块地位**
  - 列出今日市场 **最热门的前3-5个板块**。
  - 分析该股是否属于热点？资金流向如何？

  **7. 投资建议 (Actionable Advice)**
  - 持有者建议 / 空仓者建议 / 操作周期。

  **8. 明日开盘竞价推演 (Pre-Market Simulation)**
  - 请详细推演明日三种潜在开盘情况（高开、平开、低开），针对每种情况填写：
    1. **情形一：高开 (High Open)**
       - **预测价格**：___ (概率：___%)
       - **预计竞价成交量**：___ (例如：2000万)
       - **预计竞价量比**：___ (例如：1.24)
       - **9:15-9:20 试盘形态**：(描述预期的挂单量与价格变动，如“涨停价试盘后撤单”或“缓慢推升”，分析主力诱多或抢筹意图)
       - **9:20-9:25 竞价确认**：(明确指出达成此预测所需的**实际匹配成交量**或**换手率**，例如“匹配量需放大至昨日2倍”或“达到XX手”才能确认)
    2. **情形二：平开 (Flat Open)**
       - **预测价格**：___ (概率：___%)
       - **预计竞价成交量**：___
       - **预计竞价量比**：___
       - **9:15-9:20 试盘形态**：___
       - **9:20-9:25 竞价确认**：___
    3. **情形三：低开 (Low Open)**
       - **预测价格**：___ (概率：___%)
       - **预计竞价成交量**：___
       - **预计竞价量比**：___
       - **9:15-9:20 试盘形态**：___
       - **9:20-9:25 竞价确认**：___

  **9. T+1 量化追涨杀跌策略 (Quantitative Triggers)**
  - **🎯 追涨触发 (Momentum Entry)**：
     - **触发价格**：___
     - **触发条件**：(如：竞价量比>3，站稳均线，板块效应共振等)
     - **核心逻辑**：___
  - **🛑 杀跌/止损触发 (Stop Loss/Exit)**：
     - **触发价格**：___
     - **触发条件**：(如：跌破关键支撑位，主力大单流出，利空发酵等)
     - **核心逻辑**：___

  **10. 股票实估价 (Stock Fair Value)**
  - **计算逻辑**：计算出公司按照当前市值、总股本对应的合理估值股价。
  - **分析推导**：结合当前市场溢价/折价情况，给出该股的“理论合理价”。

  **11. 价值评估 (Value Assessment)**
  - **核心评估维度**：
    1. **品牌优势**：品牌溢价能力与市场认知度。
    2. **客户/员工关系**：客户忠诚度及员工稳定性/激励机制。
    3. **无形资产**：专利、技术壁垒、特许经营权等。
    4. **变现潜力**：过去变现效率及未来多元化变现的可能性。
    5. **健康规模**：资产负债表健康度与业务规模效应。
    6. **朝阳行业投入**：是否布局高增长、高潜力的朝阳产业。
    7. **增长连续性**：股票收益率与市值是否在连续增长。
    8. **投入产出比**：负债或亏损是否源于新市场投入？新市场是否已形成盈利？
    9. **产业地位**：公司业务在所属产业是否处于绝对领先或核心地位。

  **12. 资金指标分析法 (Capital Indicator Analysis)**
  - **主力资金流向**：分析大单/特大单的买入卖出净额。
  - **换手率与量比**：判断当前成交活跃度及是否存在放量/缩量异常。
  - **筹码分布**：分析当前筹码密集区，判断获利盘与套牢盘比例。
  - **资金趋势**：结合近期资金净流入情况，判断主力意图（吸筹/洗盘/出货）。

  **13. AlphaQuant 评分详情 (新规)**
  - **最终评分**：XX / 100
  - **加分项**：(列出触发了哪些具体加分条件)
  - **减分项**：(列出触发了哪些具体减分条件)
  - **综合点评**：(基于得分给出简短总结)

  **输出格式要求**：
  1. 使用标准 Markdown。
  2. 语气专业、犀利。
  3. 文末必须包含标准格式：**报告评分：XX分** (方便系统提取)。
  `;

  try {
    const response: GenerateContentResponse = await generateContentWithRetry(ai, {
      model: modelId,
      contents: [
        ...history.map(h => ({ role: h.role, parts: [{ text: typeof h.content === 'string' ? h.content : '详见报告' }] })),
        { role: 'user', parts: [{ text: prompt }] }
      ],
      config: {
        tools: [{ googleSearch: {} }],
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    const text = response.text;
    if (!text || text.trim().length === 0) {
      throw new Error("Gemini API 返回了空内容。这可能是由于安全过滤或模型限制导致的。");
    }

    return text;
  } catch (error: any) {
    // FALLBACK MECHANISM
    const errorMessage = error.message || JSON.stringify(error);
    const isQuotaError = errorMessage.includes("Quota Exceeded") || 
                         errorMessage.includes("RESOURCE_EXHAUSTED") ||
                         errorMessage.includes("check your plan");
    
    const isInternalError = errorMessage.includes("Internal error") || 
                            errorMessage.includes("500") || 
                            errorMessage.includes("INTERNAL");

    if ((isQuotaError || isInternalError) && modelId !== FALLBACK_MODEL) {
      console.warn(`Primary model (${modelId}) failed with ${isQuotaError ? 'Quota' : 'Internal'} error. Falling back to ${FALLBACK_MODEL}.`);
      try {
        const fallbackResponse: GenerateContentResponse = await generateContentWithRetry(ai, {
          model: FALLBACK_MODEL,
          contents: [
            ...history.map(h => ({ role: h.role, parts: [{ text: typeof h.content === 'string' ? h.content : '详见报告' }] })),
            { role: 'user', parts: [{ text: prompt }] }
          ],
          config: {
            tools: [{ googleSearch: {} }],
            systemInstruction: SYSTEM_INSTRUCTION,
          }
        });
        
        const reasonText = isQuotaError ? "API配额已耗尽" : "服务端暂时繁忙";
        const fallbackNote = `\n\n> ⚠️ **系统提示**：由于当前所选模型 (${modelId}) ${reasonText}，本报告已自动降级使用 **Gemini 3 Flash** 模型生成。`;
        return (fallbackResponse.text || "生成报告失败") + fallbackNote;
        
      } catch (fallbackError) {
        console.error("Fallback Model also failed:", fallbackError);
        throw error; 
      }
    }

    console.error("Gemini Analysis Error:", error);
    throw error;
  }
};

export const checkStockPrice = async (stockSymbol: string): Promise<string> => {
  const ai = getAiClient();
  const reportDate = getFormattedDate();
  
  const prompt = `
  Task: Get the EXACT REAL-TIME stock price for "${stockSymbol}".
  Current System Time: ${reportDate}.
  
  **Search Protocol (Real-time Mandatory)**:
  1. Search 1: "${stockSymbol} stock price latest today site:google.com/finance"
  2. Search 2: "${stockSymbol} 股价 今日 分时 site:xueqiu.com"
  
  **Data Validation Logic**:
  - Compare the timestamp of the found price with Current System Time.
  - **Priority**: Keep the price with the SMALLEST time difference (closest to now).
  - If "Search 1" is Yesterday and "Search 2" is Today, USE SEARCH 2.
  - If the market is open (e.g., 9:30-15:00) and the data is from 15:00 Yesterday, MARK IT AS DELAYED.
  
  **Output JSON**:
  {
    "name": "Stock Name",
    "code": "Code",
    "price": "NUMBER (e.g. 11.11)",
    "change": "+/-0.00 (0.00%)",
    "status": "Trading/Closed/Delayed",
    "time": "Data Time (e.g. 02-04 14:52)", 
    "source_url": "URL used" 
  }
  `;

  try {
    const response: GenerateContentResponse = await generateContentWithRetry(ai, {
      model: 'gemini-3-flash-preview', 
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json"
      }
    });

    return response.text || "{}";
  } catch (error) {
    console.error("Price Check Error:", error);
    throw error;
  }
};

export const analyzeChartImage = async (file: File, promptText: string, modelId: string = DEFAULT_REASONING): Promise<string> => {
  const ai = getAiClient();

  // Convert file to base64
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });

  // Remove header data:image/png;base64,
  const base64Content = base64Data.split(',')[1];
  const mimeType = file.type;

  const fullPrompt = `
  ${promptText || "分析这张股票K线图的技术面。"}
  
  请作为QFII投资总监进行分析，严格执行以下步骤：
  1. **识别形态**：(头肩顶、双底、均线排列、缺口等)。
  2. **资金博弈**：判断当前是“洗盘”、“吸筹”还是“出货”阶段。
  3. **点位预测**：给出精确的压力位和支撑位。
  4. **周期预测**：给出T+1, T+3, 1个月的价格趋势概率。
  5. **操作建议**：短线买入/卖出/持有建议。
  6. **明日开盘竞价推演**：推演高开/平开/低开的概率、预测价格、**预计竞价成交量、预计量比**，并指出竞价阶段(9:15-9:25)的试盘形态与量能确认信号。
  7. **量化追涨杀跌**：给出关键的突破买入价和破位止损价。
  8. **AlphaQuant 评分**：(0-100)，请依据趋势强弱打分。
  `;

  try {
    const response: GenerateContentResponse = await generateContentWithRetry(ai, {
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Content
            }
          },
          { text: fullPrompt }
        ]
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    const text = response.text;
    if (!text || text.trim().length === 0) {
      throw new Error("图片分析失败：模型返回了空内容。");
    }

    return text;
  } catch (error: any) {
    // FALLBACK MECHANISM FOR IMAGES
    const errorMessage = error.message || JSON.stringify(error);
    const isQuotaError = errorMessage.includes("Quota Exceeded") || errorMessage.includes("RESOURCE_EXHAUSTED");
    const isInternalError = errorMessage.includes("Internal error") || errorMessage.includes("500") || errorMessage.includes("INTERNAL");

    if ((isQuotaError || isInternalError) && modelId !== FALLBACK_MODEL) {
      console.warn(`Primary model (${modelId}) failed with ${isQuotaError ? 'Quota' : 'Internal'} error. Falling back to ${FALLBACK_MODEL}.`);
      try {
         const fallbackResponse: GenerateContentResponse = await generateContentWithRetry(ai, {
          model: FALLBACK_MODEL,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Content
                }
              },
              { text: fullPrompt }
            ]
          },
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
          }
        });
        
        const reasonText = isQuotaError ? "API配额已耗尽" : "服务端暂时繁忙";
        const fallbackNote = `\n\n> ⚠️ **系统提示**：由于当前所选模型 (${modelId}) ${reasonText}，本报告已自动降级使用 **Gemini 3 Flash** 模型生成。`;
        return (fallbackResponse.text || "无法分析图片") + fallbackNote;

      } catch (fallbackError) {
        throw error;
      }
    }

    console.error("Image Analysis Error:", error);
    throw error;
  }
};