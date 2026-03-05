export interface Note {
  id: number;
  pdf_name: string;
  page_number: number;
  content: string;
  created_at: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: { page: number; content: string }[];
}
