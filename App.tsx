/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

import { 
  Upload, 
  Send, 
  FileText, 
  Search, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Trash2,
  MessageSquare,
  BookOpen,
  XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Mermaid from './components/Mermaid';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Note, Message } from './types';

// PDF.js worker setup for Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [notes, setNotes] = useState<Note[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAbortedRef = useRef(false);

  const terminateProcessing = () => {
    isAbortedRef.current = true;
    setIsProcessing(false);
    setProgress({ current: 0, total: 0 });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    fetchNotes();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchNotes = async () => {
    try {
      const res = await fetch('/api/notes');
      const data = await res.json();
      console.log('Fetched notes:', data);
      setNotes(data);
      return data as Note[];
    } catch (err) {
      console.error('Failed to fetch notes', err);
      return [];
    }
  };

  const clearNotes = async () => {
    console.log('Clearing all notes...');
    try {
      const res = await fetch('/api/notes', { method: 'DELETE' });
      const result = await res.json();
      if (res.ok) {
        console.log(`All notes cleared successfully. Changes: ${result.changes}`);
        setNotes([]);
        setMessages([]);
      } else {
        console.error('Failed to clear notes:', res.statusText, result);
      }
    } catch (err) {
      console.error('Error clearing notes:', err);
    }
  };

  const deleteNote = async (id: number) => {
    console.log(`Deleting note with ID: ${id}`);
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (res.ok) {
        console.log(`Note ${id} deleted successfully. Changes: ${result.changes}`);
        setNotes(prev => prev.filter(n => n.id !== id));
      } else {
        console.error(`Failed to delete note ${id}:`, res.statusText, result);
      }
    } catch (err) {
      console.error(`Error deleting note ${id}:`, err);
    }
  };

  const processImage = async (base64Data: string, mimeType: string, fileName: string, pageNum: number) => {
    console.log(`Processing ${fileName} - Page ${pageNum}...`);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            { text: `Extract all text and diagrams from this handwritten page.
            - **Text Reading**: Extract all handwritten text accurately. Preserve the original layout and structure using Markdown.
            - **Diagram Detection & Drawing**: If there are diagrams, sketches, flowcharts, or drawings:
                1. Describe them in text.
                2. **CRITICAL**: Generate a Mermaid.js code block (e.g., \`\`\`mermaid ... \`\`\`) that visually represents the diagram. Use flowcharts, sequence diagrams, or mindmaps as appropriate.
            - **Formulas**: Represent mathematical formulas accurately using LaTeX-style notation.
            - **Output**: Return a clean, professional Markdown document.` }
          ]
        }
      });

      const extractedText = response.text || "No text found.";
      console.log(`Extracted text for ${fileName} - Page ${pageNum}`);

      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdf_name: fileName,
          page_number: pageNum,
          content: extractedText
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to save note: ${res.statusText}`);
      }
    } catch (err) {
      console.error(`Error processing ${fileName} - Page ${pageNum}:`, err);
      throw err;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log(`File selected: ${file.name} (${file.type})`);
    setIsProcessing(true);
    isAbortedRef.current = false;
    setError(null);
    setProgress({ current: 0, total: 0 });

    try {
      if (file.type === 'application/pdf') {
        console.log('Loading PDF...');
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages;
        console.log(`PDF loaded. Total pages: ${totalPages}`);
        setProgress({ current: 0, total: totalPages });

        for (let i = 1; i <= totalPages; i++) {
          if (isAbortedRef.current) {
            console.log('Processing terminated by user.');
            return;
          }
          console.log(`Rendering page ${i}...`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ 
            canvasContext: context!, 
            viewport 
          } as any).promise;
          const base64Image = canvas.toDataURL('image/png').split(',')[1];

          await processImage(base64Image, "image/png", file.name, i);
          setProgress(prev => ({ ...prev, current: i }));
        }
      } else if (file.type.startsWith('image/')) {
        console.log('Processing image...');
        setProgress({ current: 0, total: 1 });
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => reject(new Error('Failed to read image file'));
          reader.readAsDataURL(file);
        });
        const base64Image = await base64Promise;
        await processImage(base64Image, file.type, file.name, 1);
        setProgress({ current: 1, total: 1 });
      } else {
        throw new Error('Unsupported file type. Please upload a PDF or an image (PNG, JPG).');
      }

      console.log('File processing complete.');
      const updatedNotes = await fetchNotes();
      
      // Generate a friendly summary
      if (updatedNotes && updatedNotes.length > 0) {
        const lastFileNotes = updatedNotes.filter(n => n.pdf_name === file.name);
        const summaryContext = lastFileNotes.map(n => n.content).join('\n').substring(0, 2000);
        
        try {
          const summaryResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{
              role: 'user',
              parts: [{ text: `I have just uploaded a file named "${file.name}". 
              Here is a snippet of the extracted text:
              ${summaryContext}
              
              Please provide a very brief, friendly confirmation that you've read the notes. 
              Summarize in 1-2 sentences what the notes seem to be about, and invite me to ask questions.` }]
            }]
          });
          
          const summaryText = summaryResponse.text || `I've finished processing "${file.name}". What would you like to know about these notes?`;
          setMessages(prev => [...prev, { role: 'assistant', content: summaryText }]);
        } catch (summaryErr) {
          console.error('Failed to generate summary:', summaryErr);
          setMessages(prev => [...prev, { role: 'assistant', content: `I've finished processing "${file.name}". I'm ready to answer your questions!` }]);
        }
      }
    } catch (err: any) {
      console.error('Processing error:', err);
      setError(err.message || 'Failed to process file. Please ensure it is a valid PDF or image.');
    } finally {
      setIsProcessing(false);
      // Reset input so the same file can be uploaded again if needed
      e.target.value = '';
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      // Simple RAG: Pass all notes as context
      const context = notes.map(n => `[Page ${n.page_number}]: ${n.content}`).join('\n\n');
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { role: 'user', parts: [{ text: `You are a helpful study assistant. Answer the user's question based ONLY on the provided notes. 
          If the answer is not in the notes, say "I don't have enough information in your notes to answer that."
          Always cite the page number(s) where you found the information.
          
          NOTES:
          ${context}
          
          QUESTION:
          ${input}` }] }
        ]
      });

      const assistantContent = response.text || "I'm sorry, I couldn't generate an answer.";
      
      // Extract sources from the response if any
      const sources: { page: number; content: string }[] = [];
      const pageMatches = assistantContent.match(/Page (\d+)/gi);
      if (pageMatches) {
        pageMatches.forEach(match => {
          const pageNum = parseInt(match.match(/\d+/)![0]);
          const note = notes.find(n => n.page_number === pageNum);
          if (note && !sources.find(s => s.page === pageNum)) {
            sources.push({ page: pageNum, content: note.content });
          }
        });
      }

      setMessages(prev => [...prev, { role: 'assistant', content: assistantContent, sources }]);
    } catch (err: any) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: "Error: " + (err.message || "Failed to get response.") }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans selection:bg-[#F27D26]/20">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#1A1A1A]/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#F27D26] rounded-xl flex items-center justify-center text-white shadow-lg shadow-[#F27D26]/20">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Handwritten Note Assistant</h1>
            <p className="text-xs text-[#1A1A1A]/50 font-medium uppercase tracking-widest">Hackathon 2026 | RAG System</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {notes.length > 0 && (
            <button 
              onClick={clearNotes}
              className="p-2 text-[#1A1A1A]/40 hover:text-red-500 transition-colors relative z-10 cursor-pointer"
              title="Clear all notes"
            >
              <Trash2 size={20} />
            </button>
          )}
          <label className="cursor-pointer bg-[#1A1A1A] text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-[#1A1A1A]/90 transition-all flex items-center gap-2 shadow-xl shadow-black/10 active:scale-95">
            <Upload size={16} />
            Upload File
            <input 
              ref={fileInputRef}
              type="file" 
              className="hidden" 
              accept="application/pdf,image/*" 
              onChange={handleFileUpload} 
              disabled={isProcessing} 
            />
          </label>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 p-8 h-[calc(100vh-80px)]">
        {/* Chat Section */}
        <section className="flex flex-col bg-white rounded-3xl border border-[#1A1A1A]/5 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-[#1A1A1A]/5 flex items-center justify-between bg-[#FDFCFB]">
            <div className="flex items-center gap-2 text-[#1A1A1A]/60">
              <MessageSquare size={18} />
              <span className="text-sm font-medium">Study Chat</span>
            </div>
            <div className="flex items-center gap-4">
              {messages.length > 0 && (
                <button 
                  onClick={() => setMessages([])}
                  className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30 hover:text-red-500 transition-colors cursor-pointer"
                >
                  Clear Chat
                </button>
              )}
              {isProcessing && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-[#F27D26] text-xs font-bold uppercase tracking-tighter">
                    <Loader2 size={14} className="animate-spin" />
                    Processing Page {progress.current}/{progress.total}
                  </div>
                  <button 
                    onClick={terminateProcessing}
                    className="text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-600 transition-colors cursor-pointer border border-red-500/10 px-2 py-1 rounded-md bg-red-50/50"
                  >
                    Terminate
                  </button>
                </div>
              )}
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                <div className="w-16 h-16 bg-[#1A1A1A]/5 rounded-full flex items-center justify-center">
                  <Search size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-medium">No questions yet</h3>
                  <p className="text-sm max-w-[280px]">Upload a handwritten PDF or image to start asking questions about your notes.</p>
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex flex-col max-w-[85%]",
                    msg.role === 'user' ? "ml-auto items-end" : "items-start"
                  )}
                >
                  <div className={cn(
                    "p-4 rounded-2xl text-sm leading-relaxed",
                    msg.role === 'user' 
                      ? "bg-[#1A1A1A] text-white rounded-tr-none" 
                      : "bg-[#FDFCFB] border border-[#1A1A1A]/10 rounded-tl-none shadow-sm"
                  )}>
                    <div className="markdown-body prose prose-sm max-w-none">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ node, inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline && match && match[1] === 'mermaid' ? (
                              <Mermaid chart={String(children).replace(/\n$/, '')} />
                            ) : (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                  
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {msg.sources.map((s, i) => (
                        <span key={i} className="text-[10px] font-bold uppercase tracking-widest bg-[#F27D26]/10 text-[#F27D26] px-2 py-1 rounded-md border border-[#F27D26]/20">
                          Source: Page {s.page}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))
            )}
            {isTyping && (
              <div className="flex items-center gap-2 text-[#1A1A1A]/30">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-xs font-medium italic">Assistant is thinking...</span>
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl flex items-center gap-3 text-sm">
                <AlertCircle size={18} />
                {error}
              </div>
            )}
          </div>

          <form onSubmit={handleSendMessage} className="p-4 bg-[#FDFCFB] border-t border-[#1A1A1A]/5">
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={notes.length > 0 ? "Ask a question about your notes..." : "Upload a PDF first..."}
                disabled={notes.length === 0 || isProcessing}
                className="w-full bg-white border border-[#1A1A1A]/10 rounded-full py-4 pl-6 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-[#F27D26]/20 focus:border-[#F27D26] transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || isTyping || notes.length === 0}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-[#1A1A1A] text-white rounded-full flex items-center justify-center hover:bg-[#F27D26] transition-colors disabled:opacity-30 disabled:hover:bg-[#1A1A1A]"
              >
                <Send size={18} />
              </button>
            </div>
          </form>
        </section>

        {/* Sidebar: Extracted Content */}
        <aside className="flex flex-col gap-6 overflow-hidden">
          <div className="flex flex-col bg-white rounded-3xl border border-[#1A1A1A]/5 shadow-sm overflow-hidden h-full">
            <div className="p-4 border-b border-[#1A1A1A]/5 bg-[#FDFCFB] flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#1A1A1A]/60">
                <FileText size={18} />
                <span className="text-sm font-medium">Extracted Notes</span>
              </div>
              <div className="flex items-center gap-2">
                {notes.length > 0 && (
                  <button 
                    onClick={clearNotes}
                    className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/30 hover:text-red-500 transition-colors cursor-pointer mr-2 relative z-10"
                  >
                    Clear All
                  </button>
                )}
                <span className="text-[10px] font-bold bg-[#1A1A1A]/5 px-2 py-1 rounded-full">{notes.length} Pages</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {notes.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30 px-6">
                  <p className="text-xs font-medium uppercase tracking-widest">No data extracted</p>
                </div>
              ) : (
                notes.map((note) => (
                  <div key={note.id} className="group p-4 bg-[#FDFCFB] border border-[#1A1A1A]/5 rounded-2xl hover:border-[#F27D26]/30 transition-all">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#F27D26]">Page {note.page_number}</span>
                        <span className="text-[10px] text-[#1A1A1A]/30">{new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteNote(note.id);
                        }}
                        className="p-1.5 text-[#1A1A1A]/30 hover:text-red-500 transition-all cursor-pointer relative z-10"
                        title="Delete this page"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="markdown-body prose prose-xs text-[#1A1A1A]/70 line-clamp-3 group-hover:line-clamp-none transition-all">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ node, inline, className, children, ...props }: any) {
                            const match = /language-(\w+)/.exec(className || '');
                            return !inline && match && match[1] === 'mermaid' ? (
                              <Mermaid chart={String(children).replace(/\n$/, '')} />
                            ) : (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {note.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
