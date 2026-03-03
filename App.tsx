import React, { useState, useEffect } from 'react';
import { LayoutDashboard, History, TrendingUp, AlertCircle, Clock, ExternalLink, Trash2, Zap, Loader2 } from 'lucide-react';
import InputArea, { ModelOption } from './components/InputArea';
import ReportView from './components/ReportView';
import { generateStockReport, checkStockPrice, analyzeChartImage } from './services/geminiService';
import { ReportData, AnalysisType } from './types';

// Helper to get consistent date string for UTC+8 (Beijing Time)
const getBeijingDateStr = () => {
  return new Date().toLocaleDateString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

const App = () => {
  // Load history from localStorage on initialization
  const [history, setHistory] = useState<ReportData[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('alphaquant_history');
        return saved ? JSON.parse(saved) : [];
      } catch (e) {
        console.error("Failed to load history:", e);
        return [];
      }
    }
    return [];
  });
  
  const [currentReport, setCurrentReport] = useState<ReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState<{name: string, price: string, change: string, time: string, source_url?: string} | null>(null);

  // Quota System Version - Increment this to force reset quotas for all users
  const QUOTA_VERSION = '2026-02-22-v1.1'; 

  // Model Defaults - Updated for Gemini 3
  const DEFAULT_QUOTAS: ModelOption[] = [
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (深度思考)', quota: 50 }, 
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (极速模式)', quota: 2000 }, 
  ];

  // Model State with Daily Reset Logic
  const [selectedModelId, setSelectedModelId] = useState('gemini-3-pro-preview');
  const [quotas, setQuotas] = useState<ModelOption[]>(DEFAULT_QUOTAS);

  // Initialize and Auto-Update Quotas (UTC+8 00:00 Reset OR Version Upgrade)
  useEffect(() => {
    if (!process.env.API_KEY) {
      setError("API Key missing. Please configure process.env.API_KEY.");
    }
    
    const syncQuotas = () => {
      try {
        const todayStr = getBeijingDateStr(); // UTC+8 Date
        const savedDate = localStorage.getItem('alphaquant_quota_date');
        const savedVersion = localStorage.getItem('alphaquant_quota_version');
        const savedQuotas = localStorage.getItem('alphaquant_quotas');

        // Logic to force reset if:
        // 1. It's a new day (UTC+8)
        // 2. The quota system version has changed (Code update)
        // 3. No quotas saved
        if (savedDate !== todayStr || savedVersion !== QUOTA_VERSION) {
          console.log(`[Quota System] Resetting quotas. Reason: ${savedDate !== todayStr ? 'New Day' : 'Version Update'}`);
          setQuotas(DEFAULT_QUOTAS);
          localStorage.setItem('alphaquant_quotas', JSON.stringify(DEFAULT_QUOTAS));
          localStorage.setItem('alphaquant_quota_date', todayStr);
          localStorage.setItem('alphaquant_quota_version', QUOTA_VERSION);
        } else if (savedQuotas) {
          // Same Day & Same Version: Load saved quotas
          setQuotas(JSON.parse(savedQuotas));
        } else {
          // First run ever
          setQuotas(DEFAULT_QUOTAS);
          localStorage.setItem('alphaquant_quotas', JSON.stringify(DEFAULT_QUOTAS));
          localStorage.setItem('alphaquant_quota_date', todayStr);
          localStorage.setItem('alphaquant_quota_version', QUOTA_VERSION);
        }
      } catch (e) {
        console.error("Quota initialization error", e);
        setQuotas(DEFAULT_QUOTAS);
      }
    };

    // 1. Run immediately on mount
    syncQuotas();

    // 2. Set up interval to check every minute (handles open tabs crossing midnight)
    const intervalId = setInterval(() => {
      syncQuotas();
    }, 60000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist history whenever it changes
  useEffect(() => {
    localStorage.setItem('alphaquant_history', JSON.stringify(history));
  }, [history]);

  const updateQuota = (modelId: string, exactValue?: number) => {
    setQuotas(prevQuotas => {
      const newQuotas = prevQuotas.map(q => 
        q.id === modelId ? { ...q, quota: exactValue !== undefined ? exactValue : Math.max(0, q.quota - 1) } : q
      );
      localStorage.setItem('alphaquant_quotas', JSON.stringify(newQuotas));
      return newQuotas;
    });
  };

  const handleAnalysis = async (query: string, file?: File) => {
    // 1. Double check date/version before consuming quota (Safety check)
    const todayStr = getBeijingDateStr();
    const savedDate = localStorage.getItem('alphaquant_quota_date');
    const savedVersion = localStorage.getItem('alphaquant_quota_version');
    
    let currentQuotas = quotas;

    if (savedDate !== todayStr || savedVersion !== QUOTA_VERSION) {
       currentQuotas = DEFAULT_QUOTAS;
       setQuotas(DEFAULT_QUOTAS);
       localStorage.setItem('alphaquant_quotas', JSON.stringify(DEFAULT_QUOTAS));
       localStorage.setItem('alphaquant_quota_date', todayStr);
       localStorage.setItem('alphaquant_quota_version', QUOTA_VERSION);
    }

    // 2. Check quota availability
    const model = currentQuotas.find(q => q.id === selectedModelId);
    if (!model || model.quota <= 0) {
      setError(`模型 ${model?.name || ''} 今日免费次数已用完，请切换模型（推荐使用 Flash）。`);
      return;
    }

    setIsLoading(true);
    setError(null);
    // Don't clear currentReport immediately to allow for a smoother transition or regeneration
    // setCurrentReport(null); 

    try {
      let content = "";
      let type = AnalysisType.FULL_REPORT;
      let stockName = query.length > 10 ? "技术面分析" : query;

      if (file) {
        type = AnalysisType.IMAGE_ANALYSIS;
        content = await analyzeChartImage(file, query, selectedModelId);
      } else {
        content = await generateStockReport(query, selectedModelId);
      }

      if (!content || content.trim().length < 20) {
        throw new Error("模型返回内容异常（过短或为空），请尝试更换模型或重试。");
      }

      // Decrement quota on success
      updateQuota(selectedModelId);

      // Extract Score
      const scoreMatch = content.match(/评分[：:]\s*(\d+)/);
      const score = scoreMatch ? parseInt(scoreMatch[1]) : 75;

      // Extract Name (more robust)
      const nameMatch = content.trim().match(/^#\s*(.*?)(?:\n|\r|$)/);
      if (nameMatch && nameMatch[1].trim()) {
        stockName = nameMatch[1].trim();
      } else if (query && query.length < 20) {
        stockName = query;
      }

      const newReport: ReportData = {
        id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        stockName,
        query,
        content,
        timestamp: Date.now(),
        score: score,
        type,
        accuracyScore: score > 80 ? 9 : score > 50 ? 7 : 4
      };

      setCurrentReport(newReport);
      setHistory(prev => [newReport, ...prev]);

    } catch (e: any) {
      const errorMsg = e.message || "分析过程中发生错误，请检查网络或重试。";
      setError(errorMsg);

      // If the error is specifically a Quota error, set local quota to 0 immediately
      if (errorMsg.includes("配额已耗尽") || errorMsg.includes("Quota Exceeded") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
        updateQuota(selectedModelId, 0);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePriceCheck = async (query: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const jsonStr = await checkStockPrice(query);
      const cleanJson = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(cleanJson);
      
      setTicker({
        name: data.name || query,
        price: data.price || "N/A",
        change: data.change || "0%",
        time: data.time || new Date().toLocaleString(),
        source_url: data.source_url
      });
      
    } catch (e) {
      console.error(e);
      setError("查询股价失败，请检查代码是否正确或稍后再试。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegenerate = () => {
    if (currentReport) {
      handleAnalysis(currentReport.query);
    }
  };

  const handleFeedback = (reportId: string, rating: number, comment: string) => {
    const feedback = { rating, comment, timestamp: Date.now() };
    
    // Update history
    const updatedHistory = history.map(item => 
      item.id === reportId ? { ...item, feedback } : item
    );
    setHistory(updatedHistory);

    // Update current report if it matches
    if (currentReport?.id === reportId) {
      setCurrentReport({ ...currentReport, feedback });
    }
  };

  const handleDeleteReport = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('确定要永久删除这份历史研报吗？')) {
      const newHistory = history.filter(item => item.id !== id);
      setHistory(newHistory);
      
      if (currentReport?.id === id) {
        setCurrentReport(null);
      }
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-gray-800 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 hidden md:flex flex-col z-20 shadow-sm">
        <div className="p-6 border-b border-gray-100 bg-gradient-to-b from-white to-gray-50">
          <div className="flex items-center gap-2 text-qfii-blue font-bold text-xl tracking-tight">
            <LayoutDashboard strokeWidth={2.5} />
            <span>AlphaQuant</span>
          </div>
          <div className="flex items-center gap-1.5 mt-2 pl-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">QFII 智能投研系统</p>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase mb-3 px-2 tracking-wider">
            <History size={12} />
            <span>历史研报</span>
          </div>
          <div className="space-y-2">
            {history.map(item => (
              <div 
                key={item.id}
                onClick={() => setCurrentReport(item)}
                className={`group relative w-full flex items-center p-3 rounded-lg text-sm transition-all cursor-pointer border ${
                  currentReport?.id === item.id 
                    ? 'bg-blue-50/80 text-primary border-blue-100 shadow-sm' 
                    : 'bg-transparent text-gray-600 border-transparent hover:bg-gray-50 hover:pl-4'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate pr-4 text-xs md:text-sm">{item.stockName}</div>
                  <div className="flex justify-between items-center mt-1.5">
                     <span className="text-[10px] text-gray-400 font-mono">{new Date(item.timestamp).toLocaleDateString(undefined, {month:'numeric', day:'numeric'})}</span>
                     <div className="flex items-center gap-1">
                       {item.feedback && <span className="w-1.5 h-1.5 bg-green-500 rounded-full" title="已反馈"></span>}
                       <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${item.score >= 80 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                         {item.score}
                       </span>
                     </div>
                  </div>
                </div>
                
                <button
                  onClick={(e) => handleDeleteReport(e, item.id)}
                  className="absolute right-2 top-3 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all z-10"
                  title="删除研报"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {history.length === 0 && (
              <div className="text-center text-gray-300 text-xs py-10 border-2 border-dashed border-gray-100 rounded-lg">
                暂无历史记录
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative h-full">
        
        {/* Top Ticker Bar */}
        {ticker && (
          <div className="absolute top-4 left-4 right-4 z-40 bg-white/90 backdrop-blur-md border border-gray-200/50 rounded-xl px-4 py-2 flex items-center justify-between shadow-sm animate-in slide-in-from-top-4 duration-500">
            <div className="flex items-center gap-4 overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-800 text-sm md:text-base">{ticker.name}</span>
                {ticker.source_url && (
                  <a href={ticker.source_url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-blue-600 transition-colors">
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
              <div className="h-4 w-px bg-gray-200"></div>
              <span className="font-mono text-base md:text-lg font-bold text-gray-900 tracking-tight">{ticker.price}</span>
              <span className={`font-medium px-2 py-0.5 rounded text-xs ${ticker.change.includes('-') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {ticker.change}
              </span>
              <div className="hidden md:flex items-center gap-1 text-[10px] text-gray-400 font-mono pl-2 border-l border-gray-100 ml-2">
                <Clock size={10} />
                <span>{ticker.time}</span>
              </div>
            </div>
            <button onClick={() => setTicker(null)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-full transition-colors">
              <span className="sr-only">Close</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-hidden p-0 relative bg-[#f8f9fa]">
          {error && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-red-50/95 backdrop-blur border border-red-200 text-red-700 px-6 py-3 rounded-full shadow-xl flex items-center gap-3 text-sm animate-in fade-in slide-in-from-top-2">
              <AlertCircle size={18} />
              <span className="font-medium">{error}</span>
              <button onClick={() => setError(null)} className="ml-2 hover:bg-red-100 rounded-full p-1 transition-colors">×</button>
            </div>
          )}

          {isLoading && !currentReport ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-6 p-4 animate-in fade-in duration-500">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-100 rounded-full blur-2xl opacity-40 animate-pulse"></div>
                <Loader2 size={64} className="text-qfii-blue animate-spin relative" strokeWidth={1.5} />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-gray-800">QFII 投资总监正在深度分析</h3>
                <p className="text-sm text-gray-400">正在调取实时 Google 搜索数据与量化指标...</p>
              </div>
            </div>
          ) : !currentReport ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-8 p-4">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-100 rounded-full blur-xl opacity-50 animate-pulse"></div>
                <div className="relative w-24 h-24 bg-white rounded-2xl shadow-xl flex items-center justify-center text-qfii-blue border border-gray-100 transform -rotate-6 transition-transform hover:rotate-0 duration-500">
                  <TrendingUp size={48} strokeWidth={1.5} />
                </div>
              </div>
              
              <div className="text-center max-w-lg space-y-3">
                <h1 className="text-3xl font-bold text-gray-800 tracking-tight">AlphaQuant <span className="text-qfii-blue">Intelligence</span></h1>
                <p className="text-sm text-gray-500 leading-relaxed px-4">
                  拥有20年经验的虚拟投资总监为您服务。<br/>
                  输入股票代码或上传K线图，立即获取深度研报。
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 max-w-md w-full text-xs text-gray-400 mt-8">
                 <div className="flex items-center gap-2 justify-center bg-white p-2 rounded-lg border border-dashed border-gray-200">
                    <Zap size={14} className="text-yellow-500" />
                    <span>Gemini 3 Pro 推理模型</span>
                 </div>
                 <div className="flex items-center gap-2 justify-center bg-white p-2 rounded-lg border border-dashed border-gray-200">
                    <ExternalLink size={14} className="text-blue-500" />
                    <span>实时 Google 搜索数据</span>
                 </div>
              </div>
            </div>
          ) : (
            <div className="h-full pt-16 md:pt-6 px-2 md:px-6 pb-2 relative">
              {isLoading && (
                <div className="absolute inset-0 z-30 bg-white/60 backdrop-blur-[2px] flex items-center justify-center rounded-2xl m-2 md:m-6">
                  <div className="bg-white p-6 rounded-2xl shadow-2xl border border-gray-100 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300">
                    <Loader2 size={40} className="text-qfii-blue animate-spin" />
                    <div className="text-center">
                      <p className="font-bold text-gray-800">正在重新生成研报</p>
                      <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest">Updating Analysis...</p>
                    </div>
                  </div>
                </div>
              )}
              <ReportView 
                report={currentReport} 
                onRegenerate={handleRegenerate} 
                onFeedback={handleFeedback}
              />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-6 bg-transparent absolute bottom-0 left-0 right-0 z-10 pointer-events-none flex justify-center">
          <div className="w-full max-w-4xl pointer-events-auto">
             <InputArea 
                onSend={handleAnalysis} 
                onCheckPrice={handlePriceCheck}
                isLoading={isLoading}
                models={quotas}
                selectedModelId={selectedModelId}
                onModelSelect={setSelectedModelId}
              />
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;