import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Download, RotateCcw, Loader2, Printer, Star, MessageSquare, CheckCircle, Send, Share2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { ReportData } from '../types';

interface ReportViewProps {
  report: ReportData;
  onRegenerate: () => void;
  onFeedback: (reportId: string, rating: number, comment: string) => void;
}

const ReportView: React.FC<ReportViewProps> = ({ report, onRegenerate, onFeedback }) => {
  const [pdfDoc, setPdfDoc] = useState<jsPDF | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const reportContentRef = useRef<HTMLDivElement>(null);

  // Feedback State
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  // Reset PDF & Feedback state when report changes
  useEffect(() => {
    setPdfDoc(null);
    setIsGeneratingPdf(false);
    setRating(0);
    setComment('');
    setIsSubmittingFeedback(false);
  }, [report.id]);

  const handleGeneratePDF = async () => {
    if (!reportContentRef.current) return;
    
    setIsGeneratingPdf(true);
    
    try {
      // 1. Capture the full report content
      // Scale 2 provides good quality for print
      const contentCanvas = await html2canvas(reportContentRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      // 2. Setup PDF Constants (A4)
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = 210;
      const pdfHeight = 297;
      
      // Margins & Layout
      const margin = 15;        // 15mm margin
      const headerHeight = 15;  // Space for Header
      const footerHeight = 15;  // Space for Footer
      
      const contentWidthMM = pdfWidth - (margin * 2);
      // Usable height for the actual report image
      const contentHeightMM = pdfHeight - (margin * 2) - headerHeight - footerHeight; 

      // 3. Calculate Scaling and Paging
      // How many px in the canvas correspond to 1mm on PDF
      const pxPerMM = contentCanvas.width / contentWidthMM;
      // The height of one PDF page in canvas pixels
      const pageHeightPx = contentHeightMM * pxPerMM; 
      
      const totalPages = Math.ceil(contentCanvas.height / pageHeightPx);

      // 4. Generate Pages
      for (let i = 0; i < totalPages; i++) {
        if (i > 0) {
          pdf.addPage();
        }

        // --- Header ---
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(60, 60, 60);
        pdf.text("AlphaQuant Intelligence Report", margin, margin - 5);
        
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text(new Date(report.timestamp).toLocaleDateString(), pdfWidth - margin, margin - 5, { align: "right" });
        
        // Header Line
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.5);
        pdf.line(margin, margin, pdfWidth - margin, margin);

        // --- Content Slice ---
        const srcY = i * pageHeightPx;
        const srcH = Math.min(pageHeightPx, contentCanvas.height - srcY);

        // Create a temporary canvas to hold just this page's slice of the report
        // IMPORTANT: Canvas height must match srcH exactly to prevent squashing on short last pages
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = contentCanvas.width;
        pageCanvas.height = srcH; 
        
        const ctx = pageCanvas.getContext('2d');
        if (ctx) {
          // Fill white background to prevent transparent artifacts
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

          // Draw the slice from the main canvas
          ctx.drawImage(
            contentCanvas,
            0, srcY, contentCanvas.width, srcH, // Source
            0, 0, contentCanvas.width, srcH     // Destination (matches canvas size)
          );

          // Convert slice to image
          const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.95);
          
          // Add to PDF
          // Calculate height on PDF based on the actual slice height
          const imgHeightOnPdf = (srcH / pxPerMM); 
          
          pdf.addImage(
            pageImgData, 
            'JPEG', 
            margin, 
            margin + headerHeight + 2, // Start after top margin + header
            contentWidthMM, 
            imgHeightOnPdf
          );
        }

        // --- Footer ---
        // Footer Line
        const footerY = pdfHeight - margin;
        pdf.setDrawColor(200, 200, 200);
        pdf.line(margin, footerY, pdfWidth - margin, footerY);

        pdf.setFontSize(8);
        pdf.setTextColor(100, 100, 100);
        pdf.text("Internal Use Only - Generated by AlphaQuant AI", margin, footerY + 5);
        pdf.text(`Page ${i + 1} of ${totalPages}`, pdfWidth - margin, footerY + 5, { align: "right" });
      }

      setPdfDoc(pdf);

    } catch (error) {
      console.error("Failed to generate PDF", error);
      alert("PDF生成失败，请重试");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDownloadPDF = () => {
    if (pdfDoc) {
      const dateStr = new Date(report.timestamp).toISOString().split('T')[0];
      const fileName = `${report.stockName}_${dateStr}_研报.pdf`;
      pdfDoc.save(fileName);
    }
  };

  const submitFeedback = () => {
    if (rating === 0) return;
    setIsSubmittingFeedback(true);
    // Simulate network delay for better UX
    setTimeout(() => {
      onFeedback(report.id, rating, comment);
      setIsSubmittingFeedback(false);
    }, 600);
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-xl border border-gray-100/80 animate-in fade-in zoom-in-95 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white rounded-t-2xl">
        <div className="flex items-center gap-3">
          <div className="bg-qfii-blue text-white p-2.5 rounded-xl shadow-lg shadow-blue-900/10">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg tracking-tight">{report.stockName}</h2>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
              <span>{new Date(report.timestamp).toLocaleString()}</span>
              <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
              <span className="flex items-center gap-1 text-primary font-bold">
                 AlphaQuant Score: {report.score}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
           <button 
            onClick={onRegenerate}
            disabled={isGeneratingPdf}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            <RotateCcw size={14} />
            <span className="hidden sm:inline">重写</span>
          </button>
          
          {!pdfDoc ? (
            <button 
              onClick={handleGeneratePDF}
              disabled={isGeneratingPdf}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-all shadow-md hover:shadow-lg disabled:opacity-70"
            >
              {isGeneratingPdf ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
              <span className="hidden sm:inline">生成PDF</span>
            </button>
          ) : (
            <button 
              onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-all shadow-md animate-in fade-in slide-in-from-right-2"
            >
              <Download size={14} />
              <span className="hidden sm:inline">下载</span>
            </button>
          )}
        </div>
      </div>

      {/* Content Scroll Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-white/50">
         <article 
          ref={reportContentRef}
          className="markdown-body p-6 md:p-10 max-w-4xl mx-auto bg-white min-h-[600px]"
         >
           {/* Report Inner Header */}
           <div className="mb-8 pb-6 border-b-2 border-gray-100 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
             <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">{report.stockName} <span className="text-gray-400 font-light">|</span> 投资价值分析</h1>
                <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded">QFII Strategy</span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wider rounded">Fundamental</span>
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wider rounded">Technical</span>
                </div>
             </div>
             <div className="text-right">
                <div className="text-4xl font-bold text-qfii-blue">{report.score}<span className="text-lg text-gray-400 font-normal">/100</span></div>
                <div className="text-[10px] text-gray-400 uppercase tracking-widest mt-1">AlphaQuant Rating</div>
             </div>
           </div>

           <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({node, ...props}) => (
                <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center decoration-1 underline-offset-2" />
              ),
              table: ({node, ...props}) => (
                <div className="overflow-x-auto my-4 rounded-lg border border-gray-200 shadow-sm">
                  <table {...props} className="w-full text-sm text-left" />
                </div>
              ),
              th: ({node, ...props}) => (
                <th {...props} className="bg-gray-50 px-4 py-2 font-semibold text-gray-700 border-b border-gray-200" />
              ),
              td: ({node, ...props}) => (
                <td {...props} className="px-4 py-2 border-b border-gray-100 text-gray-600" />
              ),
              blockquote: ({node, ...props}) => (
                <blockquote {...props} className="border-l-4 border-qfii-blue bg-blue-50/30 pl-4 py-2 my-4 italic text-gray-600 rounded-r-lg" />
              )
            }}
           >
             {report.content}
           </ReactMarkdown>

           <div className="mt-12 pt-6 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
             <div>
                <p>Generated by AlphaQuant AI • Non-Financial Advice</p>
                <p>Data provided by Google Finance & Exchange Public Data</p>
             </div>
             <div className="font-mono opacity-50">
               {report.id}
             </div>
           </div>
         </article>

         {/* Feedback Mechanism (Excluded from PDF ref) */}
         <div className="max-w-2xl mx-auto my-10 px-4">
           <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
             <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-gray-800 font-bold text-sm">
                    <MessageSquare size={16} className="text-qfii-blue" />
                    评价本次分析
                </div>
             </div>

             {report.feedback ? (
               <div className="bg-green-50/50 border border-green-100 rounded-xl p-6 flex flex-col items-center justify-center text-center animate-in fade-in duration-500">
                 <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-3 shadow-sm">
                   <CheckCircle size={24} />
                 </div>
                 <h4 className="text-green-800 font-bold text-sm">反馈已提交</h4>
                 <div className="flex gap-1 mt-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star 
                        key={star} 
                        size={16} 
                        fill={star <= report.feedback!.rating ? "#FBBF24" : "none"} 
                        className={star <= report.feedback!.rating ? "text-yellow-400" : "text-gray-300"} 
                      />
                    ))}
                 </div>
                 <p className="text-green-700/80 text-xs mt-3 max-w-xs">{report.feedback.comment || "感谢您的评分"}</p>
               </div>
             ) : (
               <div className="space-y-5">
                 <div className="flex flex-col items-center justify-center">
                   <div className="flex gap-3 mb-2">
                     {[1, 2, 3, 4, 5].map((star) => (
                       <button
                         key={star}
                         onMouseEnter={() => setHoveredStar(star)}
                         onMouseLeave={() => setHoveredStar(0)}
                         onClick={() => setRating(star)}
                         className="transition-all hover:scale-110 focus:outline-none p-1"
                       >
                         <Star
                           size={32}
                           strokeWidth={1.5}
                           className={`${
                             star <= (hoveredStar || rating)
                               ? 'fill-yellow-400 text-yellow-400 drop-shadow-sm'
                               : 'text-gray-200 hover:text-gray-300'
                           } transition-colors duration-200`}
                         />
                       </button>
                     ))}
                   </div>
                   <div className="text-xs text-gray-500 font-medium h-4">
                     {hoveredStar > 0 || rating > 0 ? (
                       <span className="bg-gray-100 px-3 py-1 rounded-full">
                           {(hoveredStar || rating) === 1 ? '非常不满意 😞' :
                           (hoveredStar || rating) === 2 ? '不满意 🙁' :
                           (hoveredStar || rating) === 3 ? '一般 😐' :
                           (hoveredStar || rating) === 4 ? '满意 🙂' : '非常满意 🤩'}
                       </span>
                     ) : <span className="text-gray-300">点击星星评分</span>}
                   </div>
                 </div>

                 <div className="relative">
                   <textarea
                     value={comment}
                     onChange={(e) => setComment(e.target.value)}
                     placeholder="您觉得分析准确吗？哪里可以改进？"
                     className="w-full text-sm p-4 bg-gray-50 border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none h-24 text-gray-700 placeholder-gray-400"
                   />
                 </div>

                 <div className="flex justify-end">
                   <button
                     onClick={submitFeedback}
                     disabled={rating === 0 || isSubmittingFeedback}
                     className="flex items-center gap-2 px-6 py-2.5 bg-gray-900 text-white text-xs font-bold rounded-xl hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg active:scale-95"
                   >
                     {isSubmittingFeedback ? (
                       <Loader2 size={14} className="animate-spin" />
                     ) : (
                       <Send size={14} />
                     )}
                     提交反馈
                   </button>
                 </div>
               </div>
             )}
           </div>
         </div>
      </div>
    </div>
  );
};

export default ReportView;