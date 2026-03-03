import React, { useState, useRef } from 'react';
import { Send, Image as ImageIcon, RefreshCw, BarChart2, Cpu, ChevronDown } from 'lucide-react';

export interface ModelOption {
  id: string;
  name: string;
  quota: number;
}

interface InputAreaProps {
  onSend: (text: string, file?: File) => void;
  onCheckPrice: (text: string) => void;
  isLoading: boolean;
  models: ModelOption[];
  selectedModelId: string;
  onModelSelect: (id: string) => void;
}

const InputArea: React.FC<InputAreaProps> = ({ 
  onSend, 
  onCheckPrice, 
  isLoading,
  models,
  selectedModelId,
  onModelSelect
}) => {
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (!input.trim() && !selectedFile) return;
    onSend(input, selectedFile || undefined);
    setInput('');
    setSelectedFile(null);
  };

  const handlePriceCheck = () => {
    if (!input.trim()) return;
    onCheckPrice(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const currentModel = models.find(m => m.id === selectedModelId);
  const isQuotaExhausted = currentModel ? currentModel.quota <= 0 : false;

  return (
    <div className="w-full bg-white/95 backdrop-blur-xl shadow-2xl rounded-2xl border border-white/50 relative overflow-hidden transition-all duration-300 hover:shadow-primary/5">
      {/* Decorative gradient line */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 via-primary to-blue-600 opacity-80"></div>

      {/* Header / Model Selector */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-gray-50/50 border-b border-gray-100/50">
        <div className="flex items-center gap-2">
            <div className="bg-blue-100 p-1 rounded-md text-primary">
              <Cpu size={14} />
            </div>
            <div className="relative group flex items-center">
              <select 
                  value={selectedModelId}
                  onChange={(e) => onModelSelect(e.target.value)}
                  className="bg-transparent font-semibold text-xs text-gray-700 focus:outline-none cursor-pointer appearance-none pr-6 pl-1 py-1 hover:bg-gray-200/50 rounded transition-colors"
                  disabled={isLoading}
              >
                  {models.map(m => (
                      <option key={m.id} value={m.id}>
                          {m.name}
                      </option>
                  ))}
              </select>
              <ChevronDown size={12} className="absolute right-1 text-gray-400 pointer-events-none" />
            </div>
        </div>
        
        {currentModel && (
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5 text-[10px] font-medium">
               <span className="text-gray-400">今日剩余次数:</span>
               <span className={`px-2 py-0.5 rounded-full ${
                 currentModel.quota > 10 
                   ? 'bg-green-100 text-green-700' 
                   : currentModel.quota > 0 
                     ? 'bg-yellow-100 text-yellow-700' 
                     : 'bg-red-100 text-red-700'
               }`}>
                 {currentModel.quota}
               </span>
            </div>
            <span className="text-[8px] text-gray-300 mt-0.5 font-medium">北京时间 00:00 重置</span>
          </div>
        )}
      </div>

      <div className="p-4">
        {selectedFile && (
          <div className="flex items-center gap-3 mb-3 p-2.5 bg-blue-50/50 border border-blue-100 rounded-lg text-sm text-gray-700 animate-in slide-in-from-bottom-2 fade-in">
            <div className="w-8 h-8 bg-white rounded flex items-center justify-center text-blue-500 shadow-sm">
              <ImageIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
               <p className="truncate font-medium text-xs">{selectedFile.name}</p>
               <p className="text-[10px] text-gray-400">{(selectedFile.size / 1024).toFixed(1)} KB</p>
            </div>
            <button 
              onClick={() => setSelectedFile(null)}
              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
            >
              ✕
            </button>
          </div>
        )}
        
        <div className="flex gap-3">
          <div className="relative flex-1">
             <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isQuotaExhausted ? `${currentModel?.name} 配额已用完，请切换模型...` : "输入股票代码（如 600519）或上传K线图..."}
                className={`w-full h-full min-h-[50px] max-h-[120px] resize-none bg-transparent border-0 p-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-0 ${isQuotaExhausted ? 'text-gray-400 cursor-not-allowed' : 'text-gray-800'}`}
                disabled={isLoading || isQuotaExhausted}
                rows={1}
                style={{ height: input ? 'auto' : '50px' }} // Simple auto-growish
              />
          </div>

          <div className="flex items-end gap-2 pb-1">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`p-2.5 rounded-xl transition-all duration-200 ${
                  selectedFile 
                    ? 'bg-blue-100 text-blue-600' 
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
                title="上传图片"
                disabled={isLoading || isQuotaExhausted}
              >
                <ImageIcon size={18} />
              </button>

              {input.trim() && !selectedFile ? (
                 <button
                   onClick={handlePriceCheck}
                   disabled={isLoading}
                   className="p-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 hover:text-primary hover:border-blue-200 transition-all shadow-sm"
                   title="仅查询价格 (消耗少量配额)"
                 >
                   <BarChart2 size={18} />
                 </button>
              ) : null}

              <button
                onClick={handleSend}
                disabled={isLoading || (!input.trim() && !selectedFile) || isQuotaExhausted}
                className={`p-2.5 rounded-xl transition-all shadow-lg active:scale-95 disabled:shadow-none disabled:opacity-50 disabled:scale-100 ${
                  isQuotaExhausted 
                    ? 'bg-gray-300 text-white cursor-not-allowed' 
                    : 'bg-primary text-white hover:bg-blue-700 hover:shadow-blue-500/30'
                }`}
                title={isQuotaExhausted ? "当前模型配额已耗尽" : "生成研报"}
              >
                {isLoading ? (
                  <RefreshCw className="animate-spin" size={18} />
                ) : (
                  <Send size={18} className={input.trim() || selectedFile ? "ml-0.5" : ""} />
                )}
              </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default InputArea;