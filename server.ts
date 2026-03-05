import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("notes.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pdf_name TEXT,
    page_number INTEGER,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post("/api/notes", (req, res) => {
    const { pdf_name, page_number, content } = req.body;
    const stmt = db.prepare("INSERT INTO notes (pdf_name, page_number, content) VALUES (?, ?, ?)");
    const result = stmt.run(pdf_name, page_number, content);
    // Ensure the ID is returned as a number to avoid BigInt serialization issues
    res.json({ id: Number(result.lastInsertRowid) });
  });

  app.get("/api/notes", (req, res) => {
    const notes = db.prepare("SELECT * FROM notes ORDER BY page_number ASC").all();
    res.json(notes);
  });

  app.delete("/api/notes", (req, res) => {
    console.log('DELETE /api/notes - Clearing all notes');
    try {
      const result = db.prepare("DELETE FROM notes").run();
      console.log(`Cleared ${result.changes} notes`);
      res.json({ status: "ok", changes: result.changes });
    } catch (err) {
      console.error('Error clearing notes:', err);
      res.status(500).json({ error: "Failed to clear notes" });
    }
  });

  app.delete("/api/notes/:id", (req, res) => {
    const { id } = req.params;
    console.log(`DELETE /api/notes/${id} - Deleting specific note`);
    try {
      const result = db.prepare("DELETE FROM notes WHERE id = ?").run(Number(id));
      console.log(`Deleted note ${id}: ${result.changes} changes`);
      res.json({ status: "ok", changes: result.changes });
    } catch (err) {
      console.error(`Error deleting note ${id}:`, err);
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  app.get("/api/search", (req, res) => {
    const { q } = req.query;
    // Simple keyword search for now, can be improved
    const notes = db.prepare("SELECT * FROM notes WHERE content LIKE ?").all(`%${q}%`);
    res.json(notes);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
